"""Disposable protocol tests; actual WordPress transaction checks are separate."""
import copy
import unittest
from uuid import uuid4
from wordpress_drafts import DraftPipeline, digest


class DraftRecovery(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.scope = dict(organization_id=str(uuid4()), project_id=str(uuid4()), card_kind='engagement_work_item', card_id=str(uuid4()))
        self.site, self.origin = str(uuid4()), 'https://staging.example.test'
        self.granted = True
        self.receipts, self.work = {}, {}
        self.writes = 0
        self.fail_receiver = self.fail_work = self.corrupt = False
        self.page = dict(scope=self.scope, site_id=self.site, origin=self.origin, post_id=3156,
                         status='draft', title='Synthetic original', blocks='<!-- wp:paragraph --><p>Original</p><!-- /wp:paragraph -->', version='a'*64,
                         editor_url=self.origin+'/wp-admin/post.php?post=3156&action=edit')
        async def rpc(name, args):
            if name == 'hybrid_wordpress_draft_scope':
                if not self.granted or args['p_project'] != self.scope['project_id']:
                    raise PermissionError('denied')
                return dict(self.scope, base_url=self.origin, site_id=self.site, draft_only=True)
            request = args['p_request']
            receipt = dict(self.scope, schema_version=1, request_id=request, version_id=request,
                           document_id=request, version_number=1, state='draft', asset_kind='content')
            if request in self.work and self.work[request][0] != args:
                raise ValueError('audit conflict')
            self.work[request] = (copy.deepcopy(args), receipt)
            if self.fail_work:
                self.fail_work = False
                raise TimeoutError('lost Work response')
            return receipt
        async def receiver(action, command):
            if action == 'read':
                return copy.deepcopy(self.page)
            key, sha = command['request_id'], digest(command)
            if key in self.receipts:
                if self.receipts[key]['command_sha256'] != sha:
                    raise ValueError('request conflict')
                return copy.deepcopy(self.receipts[key])
            if command['expected_version'] != self.page['version']:
                raise ValueError('concurrent edit')
            self.writes += 1
            self.page.update(title=command['title'], blocks=command['blocks'], version=digest(command))
            result = dict(self.page, request_id=key, command_sha256=sha, revision_id=5000+self.writes, change_summary=command['change_summary'])
            self.receipts[key] = copy.deepcopy(result)
            if self.fail_receiver:
                self.fail_receiver = False
                raise TimeoutError('lost committed receiver response')
            if self.corrupt:
                result['post_id'] = 999
            return result
        self.pipeline = DraftPipeline(rpc, receiver, self.origin, self.site)
        self.args = (self.scope, str(uuid4()), 'a'*64, 'Synthetic update', '<!-- wp:paragraph --><p>Fixture update</p><!-- /wp:paragraph -->', 'Synthetic test only')

    async def test_adopted_page_update_and_retry_one_audit(self):
        first = await self.pipeline.save(*self.args)
        second = await self.pipeline.save(*self.args)
        self.assertEqual(first, second)
        self.assertEqual(first['wordpress']['post_id'],3156)
        self.assertEqual((self.writes,len(self.work)),(1,1))

    async def test_receiver_response_loss_recovers_before_audit(self):
        self.fail_receiver = True
        with self.assertRaises(TimeoutError): await self.pipeline.save(*self.args)
        self.assertEqual(len(self.work),0)
        await self.pipeline.save(*self.args)
        self.assertEqual((self.writes,len(self.work)),(1,1))

    async def test_work_response_loss_recovers_same_record(self):
        self.fail_work = True
        with self.assertRaises(TimeoutError): await self.pipeline.save(*self.args)
        await self.pipeline.save(*self.args)
        self.assertEqual((self.writes,len(self.work)),(1,1))

    async def test_stale_update_is_not_overwritten(self):
        self.page['version'] = 'b'*64
        with self.assertRaises(ValueError): await self.pipeline.save(*self.args)
        self.assertEqual((self.writes,len(self.work)),(0,0))

    async def test_reused_request_with_changed_payload_denied(self):
        await self.pipeline.save(*self.args)
        changed = list(self.args); changed[-1] = 'different payload'
        with self.assertRaises(ValueError): await self.pipeline.save(*changed)
        self.assertEqual(self.writes,1)

    async def test_revoked_and_cross_project_denied_before_provider(self):
        self.granted = False
        with self.assertRaises(PermissionError): await self.pipeline.save(*self.args)
        self.granted = True
        wrong = list(self.args); wrong[0] = dict(self.scope,project_id=str(uuid4()))
        with self.assertRaises(PermissionError): await self.pipeline.save(*wrong)
        self.assertEqual(self.writes,0)

    async def test_wrong_receiver_receipt_never_recorded(self):
        self.corrupt = True
        with self.assertRaises(ValueError): await self.pipeline.save(*self.args)
        self.assertEqual(len(self.work),0)

    async def test_historical_retry_does_not_replace_newer_page(self):
        first = await self.pipeline.save(*self.args)
        self.page['title']='Later human edit'; self.page['version']='c'*64
        self.assertEqual(await self.pipeline.save(*self.args),first)
        self.assertEqual(self.page['title'],'Later human edit')


if __name__ == '__main__': unittest.main()

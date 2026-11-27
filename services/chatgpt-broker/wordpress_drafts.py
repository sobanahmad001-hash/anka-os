"""Draft-only orchestration. Receiver owns atomic page/receipt persistence.

Work recording is an idempotent second phase: always recover the receiver receipt
with the original request before retrying the canonical Work save.
"""
import hashlib
import json
from uuid import UUID


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_scope(scope):
    if set(scope) != {'organization_id', 'project_id', 'card_kind', 'card_id'}:
        raise ValueError('Exact scope required')
    for key in ('organization_id', 'project_id', 'card_id'):
        UUID(scope[key])
    if scope['card_kind'] not in ('engagement_work_item', 'project_task'):
        raise ValueError('Canonical card required')


class DraftPipeline:
    def __init__(self, rpc, receiver, origin, site_id):
        self.rpc, self.receiver, self.origin, self.site_id = rpc, receiver, origin, site_id

    async def authorize(self, scope):
        validate_scope(scope)
        grant = await self.rpc('hybrid_wordpress_draft_scope', {
            'p_org': scope['organization_id'], 'p_project': scope['project_id'],
            'p_card_kind': scope['card_kind'], 'p_card': scope['card_id']})
        if (grant.get('base_url') != self.origin or grant.get('site_id') != self.site_id
                or grant.get('draft_only') is not True
                or any(grant.get(k) != v for k, v in scope.items())):
            raise ValueError('Current staging grant mismatch')
        return grant

    async def read(self, scope):
        await self.authorize(scope)
        result = await self.receiver('read', {'scope': scope})
        self.verify(result, scope)
        return result

    def verify(self, result, scope):
        if (result.get('scope') != scope or result.get('site_id') != self.site_id
                or result.get('origin') != self.origin or result.get('status') != 'draft'
                or type(result.get('post_id')) is not int or result['post_id'] < 1
                or not isinstance(result.get('version'), str) or len(result['version']) != 64):
            raise ValueError('Receiver scope/version mismatch')
        # Preview is an editor-generated authenticated action, never a fabricated URL.
        expected = self.origin + '/wp-admin/post.php?post=' + str(result['post_id']) + '&action=edit'
        if result.get('editor_url') != expected:
            raise ValueError('Receiver link mismatch')

    async def save(self, scope, request_id, expected_version, title, blocks, change_summary):
        validate_scope(scope)
        UUID(request_id)
        if expected_version is not None and (len(expected_version) != 64 or any(c not in '0123456789abcdef' for c in expected_version)):
            raise ValueError('Read the current version before updating')
        for value, limit in ((title, 240), (blocks, 80000), (change_summary, 1000)):
            if not isinstance(value, str) or not value.strip() or len(value) > limit:
                raise ValueError('Bounded supplied content required')
        command = dict(scope=scope, request_id=request_id, expected_version=expected_version,
                       title=title, blocks=blocks, change_summary=change_summary)
        await self.authorize(scope)  # Includes recovery; revoked users cannot recover receipts.
        receipt = await self.receiver('save', command)
        self.verify(receipt, scope)
        if (receipt.get('request_id') != request_id or receipt.get('command_sha256') != digest(command)
                or receipt.get('title') != title or receipt.get('blocks') != blocks
                or receipt.get('change_summary') != change_summary
                or type(receipt.get('revision_id')) is not int or receipt['revision_id'] <= 0):
            raise ValueError('Unverified WordPress result; retain original request')
        await self.authorize(scope)  # Recheck after external write, before Work audit.
        body = ('Verified WordPress staging draft change\n'
                f"Page: {receipt['post_id']}\nWordPress revision: {receipt['revision_id']}\n"
                f"Content version SHA256: {receipt['version']}\n"
                f"Change summary (supplied): {change_summary}\n"
                f"Editor: {receipt['editor_url']}\n"
                'Preview: open Preview in the signed-in WordPress editor.\n'
                f"Request: {request_id}\nCommand SHA256: {receipt['command_sha256']}\n"
                'Draft only. Founder visual approval pending. Executed through the scoped GPT staging tool.')
        work = await self.rpc('save_hybrid_work_draft', dict(
            p_org=scope['organization_id'], p_project=scope['project_id'],
            p_card_kind=scope['card_kind'], p_card_id=scope['card_id'], p_request=request_id,
            p_previous=None, p_title='WordPress staging change — ' + title[:200], p_body=body))
        expected = dict(scope, request_id=request_id, version_id=request_id, document_id=request_id,
                        version_number=1, state='draft', asset_kind='content', schema_version=1)
        if any(work.get(k) != v for k, v in expected.items()):
            raise ValueError('Work receipt mismatch; retry original request')
        return {'wordpress': receipt, 'work': work, 'published': False}

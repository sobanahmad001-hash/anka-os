import secrets
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.auth.oauth_proxy.models import JTIMapping, UpstreamTokenSet

from broker import Settings, create_broker


class FakeVerifier(TokenVerifier):
    def __init__(self):
        super().__init__()
        self.allowed = True

    async def verify_token(self, token):
        if token != 'synthetic-upstream-access-secret' or not self.allowed:
            return None
        return AccessToken(token=token, client_id='upstream-client', scopes=['email'], claims={})


class BrokerIsolation(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings('http://127.0.0.1:55631', 'http://127.0.0.1:55621', 'synthetic-public-key',
            'http://127.0.0.1:55621/functions/v1/hybrid-mcp', str(uuid4()),
            secrets.token_urlsafe(48), Fernet.generate_key().decode(), self.directory.name,
            ('http://127.0.0.1:55632/callback',), True)
        self.verifier = FakeVerifier()
        self.server, self.auth = create_broker(self.settings, verifier=self.verifier)
        self.auth.get_routes(mcp_path='/mcp')

    async def asyncTearDown(self):
        self.directory.cleanup()

    async def issue(self):
        token_id, jti = str(uuid4()), str(uuid4())
        now = time.time()
        await self.auth._upstream_token_store.put(key=token_id, value=UpstreamTokenSet(
            upstream_token_id=token_id, access_token='synthetic-upstream-access-secret',
            refresh_token='synthetic-upstream-refresh-secret', refresh_token_expires_at=now+7200,
            expires_at=now+3600, token_type='Bearer', scope='email', client_id='outer-client', created_at=now), ttl=3600)
        await self.auth._jti_mapping_store.put(key=jti, value=JTIMapping(jti=jti, upstream_token_id=token_id, created_at=now), ttl=3600)
        return self.auth.jwt_issuer.issue_access_token(client_id='outer-client', scopes=['email'], jti=jti)

    async def test_separate_token_encrypted_persistence_and_restart(self):
        outer = await self.issue()
        self.assertNotIn('synthetic-upstream', outer)
        self.assertEqual((await self.auth.load_access_token(outer)).token, 'synthetic-upstream-access-secret')
        raw = b''.join(p.read_bytes() for p in Path(self.directory.name).rglob('*') if p.is_file())
        self.assertNotIn(b'synthetic-upstream-access-secret', raw)
        self.assertNotIn(b'synthetic-upstream-refresh-secret', raw)
        _, restarted = create_broker(self.settings, verifier=self.verifier)
        restarted.get_routes(mcp_path='/mcp')
        self.assertIsNotNone(await restarted.load_access_token(outer))
        _, wrong_key = create_broker(replace(self.settings, encryption_key=Fernet.generate_key().decode()), verifier=self.verifier)
        wrong_key.get_routes(mcp_path='/mcp')
        self.assertIsNone(await wrong_key.load_access_token(outer))

    async def test_tamper_wrong_signer_raw_upstream_and_revocation_denied(self):
        outer = await self.issue()
        self.assertIsNone(await self.auth.load_access_token(outer[:-8] + 'abcdefgh'))
        self.assertIsNone(await self.auth.load_access_token('synthetic-upstream-access-secret'))
        _, wrong_signer = create_broker(replace(self.settings, signing_key=secrets.token_urlsafe(48)), verifier=self.verifier)
        wrong_signer.get_routes(mcp_path='/mcp')
        self.assertIsNone(await wrong_signer.load_access_token(outer))
        self.verifier.allowed = False
        self.assertIsNone(await self.auth.load_access_token(outer))

    async def test_configuration_requires_explicit_secure_callbacks_and_keys(self):
        for change in ({'local_test': False}, {'redirect_uris': ()},
                       {'redirect_uris': ('https://chatgpt.com/*',)}, {'signing_key': 'short'},
                       {'public_url': 'http://evil.example'}, {'storage_directory': 'relative'}):
            with self.assertRaises(ValueError):
                create_broker(replace(self.settings, **change), verifier=self.verifier)


if __name__ == '__main__':
    unittest.main()

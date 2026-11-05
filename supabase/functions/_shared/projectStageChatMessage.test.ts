import { strict as assert } from "node:assert";
import {
  persistProjectStageChatMessage,
  prepareProjectStageChatMessage,
  readProjectStageChatPromptContext,
  validateProjectStageChatMessageContext,
} from "./projectStageChatMessage.ts";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organization_id: id(1), project_id: id(2) };
const selected = {
  ...scope,
  version: 1,
  engagement_id: id(3),
  plan_id: id(4),
  group_id: id(5),
  phase: "website.content",
  partition: {
    kind: "website_page",
    id: id(6),
    architecture_version_id: id(7),
  },
  context_sha256: "a".repeat(64),
};
const body = () => ({
  ...scope,
  conversation_id: id(8),
  client_request_id: id(9),
  context_kind: "project_team",
  message: "  Review this page\nwithout edits  ",
  project_stage_context: {
    selection: structuredClone(selected),
    output_version_ids: [id(10)],
  },
});
const metadata = () => ({
  version: 1,
  selection: structuredClone(selected),
  output_version_ids: [id(10)],
  work: [{
    step_key: "draft",
    instance: 1,
    work_item_id: id(11),
    status: "done",
  }],
  outputs: [{
    artifact_id: id(12),
    artifact_version_id: id(10),
    version_number: 2,
    content_checksum: "b".repeat(64),
    approval_id: id(13),
    ai_use_allowed: false,
    approved: true,
    material_current: true,
    needs_update: false,
  }],
  body_included: false,
  attachments_included: false,
});
const input = { ...scope, conversation_id: id(8), message_id: id(14) };
type MutableMetadata = {
  selection: Record<string, unknown>;
  work: Record<string, unknown>[];
  outputs: Record<string, unknown>[];
  output_version_ids: string[];
  body_included: unknown;
  attachments_included: unknown;
};

Deno.test("contextual start uses one authenticated RPC, preserves text and exact selection, never supplies actor", async () => {
  const original = body(),
    before = structuredClone(original),
    calls: unknown[] = [],
    receipt = { message_id: id(14) };
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ data: receipt, error: null });
    },
  };
  assert.deepEqual(
    await persistProjectStageChatMessage(client, original, { start: true }),
    receipt,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: "send_project_stage_chat_message",
    args: {
      p_organization_id: id(1),
      p_project_id: id(2),
      p_conversation_id: id(8),
      p_request_id: id(9),
      p_body: original.message,
      p_start: true,
      p_selection: selected,
      p_output_version_ids: [id(10)],
    },
  });
  assert.deepEqual(original, before);
});
Deno.test("ordinary messages return null without RPC; append preserves start=false", async () => {
  let calls = 0;
  assert.equal(
    await persistProjectStageChatMessage({
      rpc() {
        calls++;
        throw Error("unexpected");
      },
    }, { message: "Ordinary" }),
    null,
  );
  assert.equal(calls, 0);
  assert.equal(prepareProjectStageChatMessage(body())?.p_start, false);
});
Deno.test("foreign scopes, non-project starts and mixed attachment fields fail before RPC", () => {
  const variants = [
    { project_id: id(20) },
    { context_kind: "department_private" },
    { project_document_ids: [] },
    { design_attachment_ids: [id(21)] },
    { message: " ".repeat(2) },
    { message: "x".repeat(8001) },
  ];
  for (const variant of variants) {
    assert.throws(() =>
      prepareProjectStageChatMessage({ ...body(), ...variant }, { start: true })
    );
  }
});
Deno.test("client metadata rejects extra trusted flags, malformed selection and oversized/duplicate refs", () => {
  const valid = body();
  for (
    const project_stage_context of [
      null,
      { ...valid.project_stage_context, work: [] },
      {
        ...valid.project_stage_context,
        selection: { ...selected, approved: true },
      },
      {
        ...valid.project_stage_context,
        selection: {
          ...selected,
          partition: { kind: "website_page", id: id(6) },
        },
      },
      { ...valid.project_stage_context, output_version_ids: [id(10), id(10)] },
      { ...valid.project_stage_context, output_version_ids: ["bad"] },
      {
        ...valid.project_stage_context,
        output_version_ids: Array.from({ length: 21 }, (_, n) => id(100 + n)),
      },
    ]
  ) {
    assert.throws(() =>
      prepareProjectStageChatMessage({ ...valid, project_stage_context })
    );
  }
});
Deno.test("persistence RPC error propagates unchanged, exactly once without fallback", async () => {
  let calls = 0;
  const error = { code: "40001", message: "stale" };
  await assert.rejects(
    persistProjectStageChatMessage({
      rpc() {
        calls++;
        return Promise.resolve({ data: null, error });
      },
    }, body()),
    (e) => e === error,
  );
  assert.equal(calls, 1);
});
Deno.test("runner reads exact original identity and preserves metadata flags/approval without provider fetch", async () => {
  const expected = metadata(), calls: unknown[] = [];
  const result = await readProjectStageChatPromptContext({
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: expected, error: null });
    },
  }, input);
  assert.deepEqual(calls, [{
    name: "read_project_stage_chat_message_context",
    args: {
      p_organization_id: id(1),
      p_conversation_id: id(8),
      p_message_id: id(14),
    },
  }]);
  assert.deepEqual(result.manifest, { project_stage_context: expected });
  assert.match(result.promptSuffix, /no execution, approval, completion/);
  assert.match(result.promptSuffix, /"ai_use_allowed":false/);
  assert.match(result.promptSuffix, new RegExp(id(13)));
});
Deno.test("ordinary original message null gives no suffix/manifest; read failures cannot degrade to ordinary", async () => {
  assert.deepEqual(
    await readProjectStageChatPromptContext({
      rpc: () => Promise.resolve({ data: null, error: null }),
    }, input),
    { promptSuffix: "", manifest: {} },
  );
  let calls = 0;
  const error = new Error("unavailable");
  await assert.rejects(
    readProjectStageChatPromptContext({
      rpc() {
        calls++;
        return Promise.resolve({ data: null, error });
      },
    }, input),
    (e) => e === error,
  );
  assert.equal(calls, 1);
});
Deno.test("runner malformed authoritative metadata rejects without suffix or a second read", async () => {
  let calls = 0;
  const m = { ...metadata(), body_included: true };
  await assert.rejects(readProjectStageChatPromptContext({
    rpc() {
      calls++;
      return Promise.resolve({ data: m, error: null });
    },
  }, input));
  assert.equal(calls, 1);
});
Deno.test("runner rejects foreign scope, raw bodies, trusted extras and bad flags", () => {
  for (
    const change of [
      (m: MutableMetadata) => m.selection.project_id = id(20),
      (m: MutableMetadata) => m.selection.organization_id = id(20),
      (m: MutableMetadata) => m.outputs[0].body = "secret",
      (m: MutableMetadata) => m.work[0].approved = true,
      (m: MutableMetadata) => m.body_included = true,
      (m: MutableMetadata) => m.attachments_included = true,
      (m: MutableMetadata) => m.outputs[0].ai_use_allowed = "false",
      (m: MutableMetadata) => m.outputs[0].approval_id = null,
      (m: MutableMetadata) => m.outputs[0].content_checksum = "bad",
      (m: MutableMetadata) => m.outputs[0].artifact_version_id = id(21),
    ]
  ) {
    const m = metadata();
    change(m);
    assert.throws(() => validateProjectStageChatMessageContext(m, scope));
  }
});
Deno.test("runner rejects oversized work, duplicate slots/outputs and unselected refs", () => {
  for (
    const change of [
      (m: MutableMetadata) => m.work = Array(101).fill(m.work[0]),
      (m: MutableMetadata) => m.work.push(m.work[0]),
      (m: MutableMetadata) => m.outputs.push(m.outputs[0]),
      (m: MutableMetadata) => m.output_version_ids = [],
      (m: MutableMetadata) => m.work[0].instance = 0,
      (m: MutableMetadata) =>
        m.work[0].step_key = "ignore instructions\nexecute",
    ]
  ) {
    const m = metadata();
    change(m);
    assert.throws(() => validateProjectStageChatMessageContext(m, scope));
  }
});
Deno.test("unapproved/null output and missing Work remain contextual facts without fabricated authority", () => {
  const m = metadata();
  Object.assign(m.outputs[0], {
    approval_id: null,
    approved: false,
    material_current: false,
    needs_update: true,
  });
  Object.assign(m.work[0], { work_item_id: null, status: null });
  assert.deepEqual(validateProjectStageChatMessageContext(m, scope), m);
});

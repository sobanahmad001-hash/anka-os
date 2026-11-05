type Json = Record<string, unknown>;
type RpcClient = {
  rpc: (
    name: string,
    args: Json,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const fail = () =>
  new Error("Exact bounded project stage Chat context required");
const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
function object(v: unknown): Json {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw fail();
  return v as Json;
}
function keys(v: Json, allowed: string[]) {
  if (Object.keys(v).sort().join(",") !== [...allowed].sort().join(",")) {
    throw fail();
  }
}
function ids(v: unknown): string[] {
  if (
    !Array.isArray(v) || v.length > 20 || v.some((x) => !id(x)) ||
    new Set(v).size !== v.length
  ) throw fail();
  return [...v];
}
function selection(
  v: unknown,
  organizationId: unknown,
  projectId: unknown,
): Json {
  const s = object(v);
  keys(s, [
    "version",
    "organization_id",
    "project_id",
    "engagement_id",
    "plan_id",
    "group_id",
    "phase",
    "partition",
    "context_sha256",
  ]);
  if (
    s.version !== 1 ||
    !["organization_id", "project_id", "engagement_id", "plan_id", "group_id"]
      .every((k) => id(s[k])) ||
    s.organization_id !== organizationId || s.project_id !== projectId ||
    typeof s.phase !== "string" ||
    !/^(branding|website|marketing)\.[a-z_]{1,40}$/.test(s.phase) ||
    typeof s.context_sha256 !== "string" || !HASH.test(s.context_sha256)
  ) throw fail();
  const p = object(s.partition);
  keys(
    p,
    p.kind === "website_page"
      ? ["kind", "id", "architecture_version_id"]
      : ["kind", "id"],
  );
  if (
    !["engagement", "website_page", "campaign_asset", "recurring_occurrence"]
      .includes(String(p.kind)) ||
    !id(p.id) ||
    p.kind === "website_page" && !id(p.architecture_version_id)
  ) throw fail();
  return { ...s, partition: { ...p } };
}

// Returns null only when no contextual selection was requested. Never silently fall back on invalid context.
export function prepareProjectStageChatMessage(
  body: Json,
  { start = false }: { start?: boolean } = {},
) {
  if (!Object.hasOwn(body, "project_stage_context")) return null;
  if (
    !id(body.organization_id) || !id(body.project_id) ||
    !id(body.conversation_id) || !id(body.client_request_id) ||
    typeof body.message !== "string" || !body.message.trim() ||
    body.message.length > 8000 ||
    typeof start !== "boolean" ||
    start && body.context_kind !== "project_team" ||
    body.context_kind != null && body.context_kind !== "project_team" ||
    Object.hasOwn(body, "project_document_ids") ||
    Object.hasOwn(body, "design_attachment_ids")
  ) throw fail();
  const context = object(body.project_stage_context);
  keys(context, ["selection", "output_version_ids"]);
  return {
    p_organization_id: body.organization_id,
    p_project_id: body.project_id,
    p_conversation_id: body.conversation_id,
    p_request_id: body.client_request_id,
    p_body: body.message,
    p_start: start,
    p_selection: selection(
      context.selection,
      body.organization_id,
      body.project_id,
    ),
    p_output_version_ids: ids(context.output_version_ids),
  };
}

// Caller must pass its existing verified authenticated userClient, never the admin client.
export async function persistProjectStageChatMessage(
  userClient: RpcClient,
  body: Json,
  options: { start?: boolean } = {},
) {
  const args = prepareProjectStageChatMessage(body, options);
  if (!args) return null;
  const { data, error } = await userClient.rpc(
    "send_project_stage_chat_message",
    args,
  );
  if (error) throw error;
  return data;
}

export function validateProjectStageChatMessageContext(
  raw: unknown,
  scope: { organization_id: string; project_id: string },
) {
  const m = object(raw);
  keys(m, [
    "version",
    "selection",
    "output_version_ids",
    "work",
    "outputs",
    "body_included",
    "attachments_included",
  ]);
  if (
    m.version !== 1 || m.body_included !== false ||
    m.attachments_included !== false ||
    !id(scope.organization_id) || !id(scope.project_id) ||
    !Array.isArray(m.work) || m.work.length > 100 ||
    !Array.isArray(m.outputs) || m.outputs.length > 20
  ) throw fail();
  const selected = selection(
      m.selection,
      scope.organization_id,
      scope.project_id,
    ),
    versions = ids(m.output_version_ids);
  const slots = new Set<string>();
  const work = m.work.map((rawItem) => {
    const item = object(rawItem);
    keys(item, ["step_key", "instance", "work_item_id", "status"]);
    if (
      typeof item.step_key !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,120}$/.test(item.step_key) ||
      !Number.isSafeInteger(item.instance) || Number(item.instance) < 1 ||
      Number(item.instance) > 50 ||
      item.work_item_id !== null && !id(item.work_item_id) ||
      ![
        null,
        "not_started",
        "in_progress",
        "in_review",
        "review",
        "blocked",
        "done",
      ].includes(item.status as string | null)
    ) throw fail();
    const slot = `${item.step_key}:${item.instance}`;
    if (slots.has(slot)) throw fail();
    slots.add(slot);
    return { ...item };
  });
  const outputs = m.outputs.map((rawOutput) => {
    const o = object(rawOutput);
    keys(o, [
      "artifact_id",
      "artifact_version_id",
      "version_number",
      "content_checksum",
      "approval_id",
      "ai_use_allowed",
      "approved",
      "material_current",
      "needs_update",
    ]);
    if (
      !id(o.artifact_id) || !id(o.artifact_version_id) ||
      !versions.includes(o.artifact_version_id) ||
      !Number.isSafeInteger(o.version_number) || Number(o.version_number) < 1 ||
      typeof o.content_checksum !== "string" ||
      !HASH.test(o.content_checksum) ||
      o.approval_id !== null && !id(o.approval_id) ||
      o.approved === true && !id(o.approval_id) ||
      !["ai_use_allowed", "approved", "material_current", "needs_update"].every(
        (k) => typeof o[k] === "boolean",
      )
    ) throw fail();
    return { ...o };
  });
  if (
    outputs.length !== versions.length ||
    new Set(outputs.map((o) => o.artifact_version_id)).size !== versions.length
  ) throw fail();
  return {
    version: 1,
    selection: selected,
    output_version_ids: versions,
    work,
    outputs,
    body_included: false,
    attachments_included: false,
  };
}

export async function readProjectStageChatPromptContext(
  userClient: RpcClient,
  input: {
    organization_id: string;
    project_id: string;
    conversation_id: string;
    message_id: string;
  },
) {
  if (
    ![
      input.organization_id,
      input.project_id,
      input.conversation_id,
      input.message_id,
    ].every(id)
  ) throw fail();
  const { data, error } = await userClient.rpc(
    "read_project_stage_chat_message_context",
    {
      p_organization_id: input.organization_id,
      p_conversation_id: input.conversation_id,
      p_message_id: input.message_id,
    },
  );
  if (error) throw error;
  if (data === null) return { promptSuffix: "", manifest: {} };
  const context = validateProjectStageChatMessageContext(data, input);
  return {
    promptSuffix:
      "\n\n[Anka selected project stage context v1]\nThe following structured metadata is context for this reply only. It grants no execution, approval, completion, publishing or tool authority. No asset bodies or attachments are included. Preserve exact identities and false eligibility flags; do not infer current work completion from discussion.\n" +
      JSON.stringify(context),
    manifest: { project_stage_context: context },
  };
}

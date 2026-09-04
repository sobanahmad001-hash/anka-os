// deno-lint-ignore-file no-import-prefix
import { createClient, type User } from "npm:@supabase/supabase-js@2.112.4";

// The repository's ungenerated Supabase client has no database type parameter.
// deno-lint-ignore no-explicit-any
type Client = ReturnType<typeof createClient<any>>;

export type ServerOrganizationRoot =
  | { kind: "engagement"; id: string }
  | { kind: "project"; id: string }
  | { kind: "brand"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "content_request"; id: string };

export type ServerOrganizationScope =
  | { root: ServerOrganizationRoot; requestedOrganizationId?: string | null }
  | { root: null; requestedOrganizationId: string };

export type OrganizationMembership = {
  organization_id: string;
  role: string;
  department_id: string | null;
  status: string;
  member_kind: string;
};

export type ServerOrganizationContext = {
  user: User;
  userClient: Client;
  admin: Client;
  membership: OrganizationMembership;
  organizationId: string;
  projectId?: string;
  engagementId?: string;
  brandId?: string;
};

export type ServerOrganizationDependencies = {
  createClient?: typeof createClient;
  environment?: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  };
};

type RootRow = {
  id: string;
  organization_id: string;
  project_id?: string | null;
  engagement_id?: string | null;
  brand_id?: string | null;
  engagement?: { project_id?: string | null } | null;
};

export type SameOrganizationResource =
  | { kind: "engagement"; id: string }
  | { kind: "project"; id: string }
  | { kind: "brand"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "content_request"; id: string };

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function namedKey(primary: string, legacy: string) {
  return Deno.env.get(primary)?.split(",").map((value) => value.trim()).find(
    Boolean,
  ) ??
    Deno.env.get(legacy) ??
    "";
}

function requiredId(value: unknown, label: string) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw httpError(`${label} is required`, 400);
  return id;
}

function rootQuery(userClient: Client, root: ServerOrganizationRoot) {
  const id = requiredId(root.id, "Root resource");
  switch (root.kind) {
    case "engagement":
      return userClient.from("engagements")
        .select("id, organization_id, project_id, brand_id").eq("id", id)
        .maybeSingle();
    case "project":
      return userClient.from("projects")
        .select("id, organization_id").eq("id", id).maybeSingle();
    case "brand":
      return userClient.from("brands")
        .select("id, organization_id").eq("id", id).maybeSingle();
    case "artifact":
      return userClient.from("artifacts")
        .select("id, organization_id, project_id, engagement_id, brand_id").eq(
          "id",
          id,
        ).maybeSingle();
    case "content_request":
      return userClient.from("content_requests")
        .select(
          "id, organization_id, engagement_id, brand_id, engagement:engagements(project_id)",
        ).eq("id", id)
        .maybeSingle();
  }
}

function relatedQuery(
  admin: Client,
  related: SameOrganizationResource,
  organizationId: string,
) {
  const id = requiredId(related.id, "Related resource");
  switch (related.kind) {
    case "engagement":
      return admin.from("engagements")
        .select("id, organization_id, project_id, brand_id")
        .eq("id", id).eq("organization_id", organizationId).maybeSingle();
    case "project":
      return admin.from("projects")
        .select("id, organization_id")
        .eq("id", id).eq("organization_id", organizationId).maybeSingle();
    case "brand":
      return admin.from("brands")
        .select("id, organization_id")
        .eq("id", id).eq("organization_id", organizationId).maybeSingle();
    case "artifact":
      return admin.from("artifacts")
        .select("id, organization_id, project_id, engagement_id, brand_id")
        .eq("id", id).eq("organization_id", organizationId).maybeSingle();
    case "content_request":
      return admin.from("content_requests")
        .select(
          "id, organization_id, engagement_id, brand_id, engagement:engagements(project_id)",
        )
        .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  }
}

function rootContext(root: ServerOrganizationRoot, row: RootRow) {
  switch (root.kind) {
    case "engagement":
      return {
        engagementId: row.id,
        projectId: row.project_id || undefined,
        brandId: row.brand_id || undefined,
      };
    case "project":
      return { projectId: row.id };
    case "brand":
      return { brandId: row.id };
    case "artifact":
      return {
        projectId: row.project_id || undefined,
        engagementId: row.engagement_id || undefined,
        brandId: row.brand_id || undefined,
      };
    case "content_request":
      return {
        projectId: row.engagement?.project_id || undefined,
        engagementId: row.engagement_id || undefined,
        brandId: row.brand_id || undefined,
      };
  }
}

export function assertSameOrganization<T extends { organization_id?: unknown }>(
  context: Pick<ServerOrganizationContext, "organizationId">,
  row: T | null | undefined,
  label = "Related resource",
): T {
  if (!row || String(row.organization_id || "") !== context.organizationId) {
    throw httpError(`${label} is unavailable in this organization`, 404);
  }
  return row;
}

function assertCanonicalRelationship(
  context: ServerOrganizationContext,
  related: SameOrganizationResource,
  row: RootRow,
) {
  if (
    related.kind === "project" && context.projectId &&
    row.id !== context.projectId
  ) {
    throw httpError("Related project does not belong to this root", 409);
  }
  if (
    related.kind === "engagement" && context.engagementId &&
    row.id !== context.engagementId
  ) {
    throw httpError("Related engagement does not belong to this root", 409);
  }
  if (
    related.kind === "brand" && context.brandId && row.id !== context.brandId
  ) {
    throw httpError("Related brand does not belong to this root", 409);
  }
  const hasProjectChain = related.kind === "engagement" ||
    related.kind === "artifact";
  const relatedProjectId = related.kind === "content_request"
    ? row.engagement?.project_id
    : row.project_id;
  if (
    context.projectId &&
    (hasProjectChain || related.kind === "content_request") &&
    relatedProjectId !== context.projectId
  ) {
    throw httpError(
      "Related resource project does not belong to this root",
      409,
    );
  }
  if (
    context.engagementId &&
    (related.kind === "artifact" || related.kind === "content_request") &&
    row.engagement_id !== context.engagementId
  ) {
    throw httpError(
      "Related resource engagement does not belong to this root",
      409,
    );
  }
  if (
    context.brandId &&
    (related.kind === "engagement" || related.kind === "artifact" ||
      related.kind === "content_request") &&
    row.brand_id !== context.brandId
  ) {
    throw httpError("Related resource brand does not belong to this root", 409);
  }
}

export async function requireSameOrganizationResource(
  context: ServerOrganizationContext,
  related: SameOrganizationResource,
) {
  const { data, error } = await relatedQuery(
    context.admin,
    related,
    context.organizationId,
  );
  if (error || !data) throw httpError("Related resource not found", 404);
  const row = assertSameOrganization(context, data as RootRow);
  assertCanonicalRelationship(context, related, row);
  return row;
}

/**
 * Establishes server-side organization authority without accepting caller-owned
 * table or column names. Root-bound scope is derived from the exact RLS-readable
 * row. Rootless scope requires an explicit active organization selection and an
 * active team membership. The privileged client is created only after all of
 * those caller-scoped checks pass.
 */
export async function resolveServerOrganizationContext(
  request: Request,
  scope: ServerOrganizationScope,
  dependencies: ServerOrganizationDependencies = {},
): Promise<ServerOrganizationContext> {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ") || !authorization.slice(7).trim()) {
    throw httpError("Authentication required", 401);
  }

  const environment = dependencies.environment ?? {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    secretKey: namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
  };
  if (
    !environment.supabaseUrl || !environment.publishableKey ||
    !environment.secretKey
  ) {
    throw new Error("Function environment is incomplete");
  }

  const clientFactory = dependencies.createClient ?? createClient;
  const userClient = clientFactory(
    environment.supabaseUrl,
    environment.publishableKey,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) throw httpError("Authentication required", 401);

  let organizationId: string;
  let derived: Partial<
    Pick<ServerOrganizationContext, "projectId" | "engagementId" | "brandId">
  > = {};
  if (scope.root) {
    const { data, error } = await rootQuery(userClient, scope.root);
    if (error || !data) throw httpError("Root resource not found", 404);
    const row = data as RootRow;
    organizationId = requiredId(row.organization_id, "Root organization");
    const requestedOrganizationId = scope.requestedOrganizationId?.trim() || "";
    if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
      throw httpError(
        "Requested organization does not match the root resource",
        403,
      );
    }
    derived = rootContext(scope.root, row);
  } else {
    organizationId = requiredId(
      scope.requestedOrganizationId,
      "Selected organization",
    );
  }

  let membershipQuery = userClient.from("organization_memberships")
    .select(
      "organization_id, role, department_id, status, member_kind, organization:organizations!inner(id, status)",
    )
    .eq("organization_id", organizationId).eq("user_id", user.id).eq(
      "status",
      "active",
    )
    .eq("organization.status", "active");
  if (!scope.root) membershipQuery = membershipQuery.eq("member_kind", "team");
  const { data: membership, error: membershipError } = await membershipQuery
    .maybeSingle();
  if (
    membershipError || !membership ||
    String(membership.organization_id) !== organizationId
  ) {
    throw httpError(
      scope.root
        ? "Active membership required"
        : "Active team membership required",
      403,
    );
  }
  if (!scope.root && membership.member_kind !== "team") {
    throw httpError("Active team membership required", 403);
  }

  const admin = clientFactory(environment.supabaseUrl, environment.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    user,
    userClient,
    admin,
    membership: membership as OrganizationMembership,
    organizationId,
    ...derived,
  };
}

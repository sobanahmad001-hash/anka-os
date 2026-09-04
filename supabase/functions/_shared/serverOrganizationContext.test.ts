// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  assertSameOrganization,
  requireSameOrganizationResource,
  resolveServerOrganizationContext,
  type ServerOrganizationScope,
} from "./serverOrganizationContext.ts";

type Row = Record<string, unknown>;
const environment = {
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "publishable",
  secretKey: "secret",
};

function fixture(options: {
  roots?: Record<string, Row[]>;
  memberships?: Row[];
  organizations?: Row[];
  user?: Row | null;
} = {}) {
  const roots = options.roots ?? {};
  const memberships = options.memberships ?? [];
  const organizations = options.organizations ?? [
    { id: "org-a", status: "active" },
    { id: "org-b", status: "active" },
  ];
  const calls: Array<{
    client: "user" | "admin";
    table: string;
    operation: string;
    column?: string;
    value?: unknown;
  }> = [];
  let factoryCalls = 0;

  function client(kind: "user" | "admin") {
    return {
      auth: {
        getUser: () => ({
          data: {
            user: options.user === undefined ? { id: "actor" } : options.user,
          },
          error: null,
        }),
      },
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          select() {
            calls.push({ client: kind, table, operation: "select" });
            return builder;
          },
          eq(column: string, value: unknown) {
            calls.push({ client: kind, table, operation: "eq", column, value });
            filters.push([column, value]);
            return builder;
          },
          insert() {
            calls.push({ client: kind, table, operation: "insert" });
            return builder;
          },
          update() {
            calls.push({ client: kind, table, operation: "update" });
            return builder;
          },
          delete() {
            calls.push({ client: kind, table, operation: "delete" });
            return builder;
          },
          maybeSingle() {
            const rows = table === "organization_memberships"
              ? memberships
              : table === "organizations"
              ? organizations
              : (roots[table] ?? []);
            const row =
              rows.find((candidate) =>
                filters.every(([column, value]) => {
                  if (column === "organization.status") {
                    return organizations.some((org) =>
                      org.id === candidate.organization_id &&
                      org.status === value
                    );
                  }
                  return candidate[column] === value;
                })
              ) ?? null;
            return { data: row, error: null };
          },
        };
        return builder;
      },
    };
  }

  return {
    calls,
    get factoryCalls() {
      return factoryCalls;
    },
    dependencies: {
      environment,
      createClient:
        (() => client(factoryCalls++ === 0 ? "user" : "admin")) as never,
    },
  };
}

function request() {
  return new Request("https://functions.example/resolver", {
    headers: { Authorization: "Bearer caller-jwt" },
  });
}

function activeMembership(organizationId: string, overrides: Row = {}) {
  return {
    organization_id: organizationId,
    user_id: "actor",
    role: "contributor",
    department_id: "content",
    member_kind: "team",
    status: "active",
    ...overrides,
  };
}

function artifactVersion(
  id: string,
  organizationId: string,
  suffix: string,
  artifactType = "content",
) {
  return {
    id,
    organization_id: organizationId,
    artifact_id: `artifact-${suffix}`,
    artifact: {
      id: `artifact-${suffix}`,
      organization_id: organizationId,
      project_id: `project-${suffix}`,
      engagement_id: `engagement-${suffix}`,
      brand_id: `brand-${suffix}`,
      artifact_type: artifactType,
    },
  };
}

Deno.test("root-bound resolution derives the exact caller-readable A/B root, never requested organization authority", async () => {
  const path = fixture({
    roots: {
      engagements: [
        {
          id: "same-shaped-a",
          organization_id: "org-a",
          project_id: "project-a",
          brand_id: "brand-a",
        },
        {
          id: "same-shaped-b",
          organization_id: "org-b",
          project_id: "project-b",
          brand_id: "brand-b",
        },
      ],
    },
    memberships: [activeMembership("org-a"), activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "engagement", id: "same-shaped-b" },
    requestedOrganizationId: "org-b",
  }, path.dependencies);

  assertEquals(context.organizationId, "org-b");
  assertEquals(context.engagementId, "same-shaped-b");
  assertEquals(context.projectId, "project-b");
  assertEquals(context.brandId, "brand-b");
  assertEquals(
    path.calls.filter((call) =>
      call.table === "engagements" && call.client === "user"
    )
      .some((call) => call.column === "id" && call.value === "same-shaped-b"),
    true,
  );
  assertEquals(
    path.calls.some((call) =>
      call.table === "engagements" && call.column === "organization_id"
    ),
    false,
  );
});

Deno.test("same-shaped A/B queue roots derive only the caller-readable entry organization and brand", async () => {
  const path = fixture({
    roots: {
      content_queue_entries: [
        { id: "queue-a", organization_id: "org-a", brand_id: "brand-a" },
        { id: "queue-b", organization_id: "org-b", brand_id: "brand-b" },
      ],
    },
    memberships: [activeMembership("org-a"), activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "content_queue_entry", id: "queue-b" },
    requestedOrganizationId: "org-b",
  }, path.dependencies);
  assertEquals(context.organizationId, "org-b");
  assertEquals(context.brandId, "brand-b");
  assertEquals(
    path.calls.some((call) =>
      call.client === "user" && call.table === "content_queue_entries" &&
      call.column === "id" && call.value === "queue-b"
    ),
    true,
  );
});

Deno.test("same-shaped A/B artifact-version roots derive the complete caller-readable artifact chain", async () => {
  const path = fixture({
    roots: {
      artifact_versions: [
        artifactVersion("version-a", "org-a", "a"),
        artifactVersion("version-b", "org-b", "b"),
      ],
    },
    memberships: [activeMembership("org-a"), activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "artifact_version", id: "version-b" },
    requestedOrganizationId: "org-b",
  }, path.dependencies);
  assertEquals(context.organizationId, "org-b");
  assertEquals(context.artifactId, "artifact-b");
  assertEquals(context.artifactType, "content");
  assertEquals(context.projectId, "project-b");
  assertEquals(context.engagementId, "engagement-b");
  assertEquals(context.brandId, "brand-b");
});

for (
  const scenario of [
    {
      name: "queue requested-org mismatch",
      roots: {
        content_queue_entries: [
          { id: "queue-b", organization_id: "org-b", brand_id: "brand-b" },
        ],
      },
      root: { kind: "content_queue_entry", id: "queue-b" } as const,
    },
    {
      name: "version requested-org mismatch",
      roots: {
        artifact_versions: [artifactVersion("version-b", "org-b", "b")],
      },
      root: { kind: "artifact_version", id: "version-b" } as const,
    },
  ]
) {
  Deno.test(`${scenario.name} fails before privileged or side-effect access`, async () => {
    const path = fixture({
      roots: scenario.roots as unknown as Record<string, Row[]>,
      memberships: [activeMembership("org-b")],
    });
    await assertRejects(
      () =>
        resolveServerOrganizationContext(request(), {
          root: scenario.root,
          requestedOrganizationId: "org-a",
        }, path.dependencies),
      Error,
      "Requested organization does not match",
    );
    assertEquals(path.factoryCalls, 1);
    assertEquals(path.calls.some((call) => call.client === "admin"), false);
    assertEquals(
      path.calls.some((call) =>
        ["insert", "update", "delete"].includes(call.operation) ||
        /provider|storage/i.test(call.table)
      ),
      false,
    );
  });
}

for (
  const scenario of [
    {
      name: "unreadable queue",
      roots: { content_queue_entries: [] },
      root: { kind: "content_queue_entry", id: "queue-foreign" } as const,
      membership: activeMembership("org-b"),
    },
    {
      name: "unreadable version",
      roots: { artifact_versions: [] },
      root: { kind: "artifact_version", id: "version-foreign" } as const,
      membership: activeMembership("org-b"),
    },
    {
      name: "client-only queue",
      roots: { content_queue_entries: [] },
      root: { kind: "content_queue_entry", id: "queue-b" } as const,
      membership: activeMembership("org-b", {
        member_kind: "client",
        role: "client_viewer",
        department_id: null,
      }),
    },
  ]
) {
  Deno.test(`${scenario.name} fails at caller-readable root before privileged access`, async () => {
    const path = fixture({
      roots: scenario.roots as unknown as Record<string, Row[]>,
      memberships: [scenario.membership],
    });
    await assertRejects(
      () =>
        resolveServerOrganizationContext(request(), {
          root: scenario.root,
          requestedOrganizationId: "org-b",
        }, path.dependencies),
      Error,
      "Root resource not found",
    );
    assertEquals(path.factoryCalls, 1);
    assertEquals(path.calls.some((call) => call.client === "admin"), false);
  });
}

Deno.test("multi-org rootless resolution requires explicit selection and never picks first membership", async () => {
  const path = fixture({
    memberships: [activeMembership("org-a"), activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: null,
    requestedOrganizationId: "org-b",
  }, path.dependencies);
  assertEquals(context.organizationId, "org-b");
  assertEquals(context.membership.organization_id, "org-b");
  assertEquals(
    path.calls.some((call) =>
      call.table === "organization_memberships" &&
      call.column === "organization_id" && call.value === "org-b"
    ),
    true,
  );

  const missing = fixture({
    memberships: [activeMembership("org-a"), activeMembership("org-b")],
  });
  await assertRejects(
    () =>
      resolveServerOrganizationContext(request(), {
        root: null,
        requestedOrganizationId: "",
      }, missing.dependencies),
    Error,
    "Selected organization is required",
  );
  assertEquals(
    missing.calls.some((call) => call.table === "organization_memberships"),
    false,
  );
  assertEquals(missing.factoryCalls, 1);
});

for (
  const scenario of [
    {
      name: "inactive membership",
      membership: activeMembership("org-b", { status: "suspended" }),
    },
    {
      name: "revoked membership",
      membership: activeMembership("org-b", { status: "revoked" }),
    },
    {
      name: "inactive organization",
      membership: activeMembership("org-b"),
      organizations: [{ id: "org-b", status: "suspended" }],
    },
  ]
) {
  Deno.test(`rootless resolution rejects ${scenario.name} before privileged access`, async () => {
    const path = fixture({
      memberships: [scenario.membership],
      organizations: scenario.organizations,
    });
    await assertRejects(
      () =>
        resolveServerOrganizationContext(request(), {
          root: null,
          requestedOrganizationId: "org-b",
        }, path.dependencies),
      Error,
      "Active team membership required",
    );
    assertEquals(path.factoryCalls, 1);
    assertEquals(path.calls.some((call) => call.client === "admin"), false);
  });
}

Deno.test("rootless rejects client-only actor while root-bound preserves RLS-readable client semantics", async () => {
  const membership = activeMembership("org-b", {
    member_kind: "client",
    role: "client_viewer",
    department_id: null,
  });
  const rootless = fixture({ memberships: [membership] });
  await assertRejects(
    () =>
      resolveServerOrganizationContext(request(), {
        root: null,
        requestedOrganizationId: "org-b",
      }, rootless.dependencies),
    Error,
    "Active team membership required",
  );
  assertEquals(rootless.factoryCalls, 1);

  const rooted = fixture({
    roots: {
      content_requests: [
        {
          id: "request-b",
          organization_id: "org-b",
          engagement_id: null,
          brand_id: "brand-b",
        },
      ],
    },
    memberships: [membership],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "content_request", id: "request-b" },
    requestedOrganizationId: "org-b",
  }, rooted.dependencies);
  assertEquals(context.membership.member_kind, "client");
  assertEquals(context.organizationId, "org-b");
});

for (
  const scenario of [
    "unreadable target",
    "requested organization mismatch",
  ] as const
) {
  Deno.test(`${scenario} fails before privileged client, mutation, provider, or storage access`, async () => {
    const path = fixture({
      roots: {
        artifacts: scenario === "unreadable target" ? [] : [
          {
            id: "artifact-b",
            organization_id: "org-b",
            project_id: "project-b",
            engagement_id: "engagement-b",
            brand_id: "brand-b",
          },
        ],
      },
      memberships: [activeMembership("org-b")],
    });
    const scope: ServerOrganizationScope = {
      root: { kind: "artifact", id: "artifact-b" },
      requestedOrganizationId: scenario === "requested organization mismatch"
        ? "org-a"
        : "org-b",
    };
    await assertRejects(
      () =>
        resolveServerOrganizationContext(request(), scope, path.dependencies),
      Error,
      scenario === "unreadable target"
        ? "Root resource not found"
        : "Requested organization does not match",
    );
    assertEquals(path.factoryCalls, 1);
    assertEquals(path.calls.some((call) => call.client === "admin"), false);
    assertEquals(
      path.calls.some((call) =>
        ["insert", "update", "delete"].includes(call.operation)
      ),
      false,
    );
    assertEquals(
      path.calls.some((call) => /provider|storage/i.test(call.table)),
      false,
    );
  });
}

Deno.test("same-organization helpers reject foreign rows and cross-org related-row injection", async () => {
  const path = fixture({
    roots: {
      engagements: [
        {
          id: "engagement-b",
          organization_id: "org-b",
          project_id: "project-b",
          brand_id: "brand-b",
        },
      ],
      artifacts: [
        {
          id: "artifact-a",
          organization_id: "org-a",
          project_id: "project-a",
          engagement_id: "engagement-a",
          brand_id: "brand-a",
        },
      ],
    },
    memberships: [activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "engagement", id: "engagement-b" },
    requestedOrganizationId: "org-b",
  }, path.dependencies);

  await assertRejects(
    () =>
      requireSameOrganizationResource(context, {
        kind: "artifact",
        id: "artifact-a",
      }),
    Error,
    "Related resource not found",
  );
  assertEquals(
    path.calls.filter((call) =>
      call.client === "admin" && call.table === "artifacts"
    )
      .some((call) =>
        call.column === "organization_id" && call.value === "org-b"
      ),
    true,
  );
  try {
    assertSameOrganization(context, {
      id: "foreign",
      organization_id: "org-a",
    });
    throw new Error("Expected foreign-row assertion to fail");
  } catch (error) {
    assertEquals(
      (error as Error).message,
      "Related resource is unavailable in this organization",
    );
  }
  assertEquals(
    path.calls.some((call) =>
      ["insert", "update", "delete"].includes(call.operation)
    ),
    false,
  );
});

Deno.test("field definitions are organization constrained and must match the artifact-version type", async () => {
  const path = fixture({
    roots: {
      artifact_versions: [
        artifactVersion("version-b", "org-b", "b", "content"),
      ],
      artifact_custom_field_defs: [
        {
          id: "definition-a",
          organization_id: "org-a",
          artifact_type: "content",
        },
        {
          id: "definition-b",
          organization_id: "org-b",
          artifact_type: "content",
        },
        {
          id: "definition-wrong",
          organization_id: "org-b",
          artifact_type: "scripts",
        },
      ],
    },
    memberships: [activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "artifact_version", id: "version-b" },
    requestedOrganizationId: "org-b",
  }, path.dependencies);

  const definition = await requireSameOrganizationResource(context, {
    kind: "artifact_custom_field_definition",
    id: "definition-b",
  });
  assertEquals(definition.id, "definition-b");
  await assertRejects(
    () =>
      requireSameOrganizationResource(context, {
        kind: "artifact_custom_field_definition",
        id: "definition-a",
      }),
    Error,
    "Related resource not found",
  );
  await assertRejects(
    () =>
      requireSameOrganizationResource(context, {
        kind: "artifact_custom_field_definition",
        id: "definition-wrong",
      }),
    Error,
    "does not match the artifact type",
  );
  assertEquals(
    path.calls.filter((call) =>
      call.client === "admin" && call.table === "artifact_custom_field_defs"
    ).every((call) =>
      call.operation !== "eq" || call.column !== "organization_id" ||
      call.value === "org-b"
    ),
    true,
  );
  assertEquals(
    path.calls.some((call) =>
      ["insert", "update", "delete"].includes(call.operation)
    ),
    false,
  );
});

Deno.test("same-org related rows must still match the root canonical chain", async () => {
  const path = fixture({
    roots: {
      engagements: [
        {
          id: "engagement-b",
          organization_id: "org-b",
          project_id: "project-b",
          brand_id: "brand-b",
        },
      ],
      artifacts: [{
        id: "artifact-other",
        organization_id: "org-b",
        project_id: "project-other",
        engagement_id: "engagement-other",
        brand_id: "brand-other",
      }],
      content_requests: [{
        id: "request-other",
        organization_id: "org-b",
        engagement_id: "engagement-other",
        brand_id: "brand-other",
        engagement: { project_id: "project-other" },
      }],
      artifact_versions: [
        artifactVersion("version-other", "org-b", "other", "content"),
      ],
    },
    memberships: [activeMembership("org-b")],
  });
  const context = await resolveServerOrganizationContext(request(), {
    root: { kind: "engagement", id: "engagement-b" },
  }, path.dependencies);
  await assertRejects(
    () =>
      requireSameOrganizationResource(context, {
        kind: "artifact",
        id: "artifact-other",
      }),
    Error,
    "does not belong to this root",
  );
  await assertRejects(
    () =>
      requireSameOrganizationResource(context, {
        kind: "artifact_version",
        id: "version-other",
      }),
    Error,
    "does not belong to this root",
  );
  await assertRejects(
    () =>
      requireSameOrganizationResource(context, {
        kind: "content_request",
        id: "request-other",
      }),
    Error,
    "does not belong to this root",
  );
  assertEquals(
    path.calls.some((call) =>
      ["insert", "update", "delete"].includes(call.operation)
    ),
    false,
  );
});

Deno.test("missing or invalid bearer authentication fails before any data or privileged access", async () => {
  const missing = fixture();
  await assertRejects(
    () =>
      resolveServerOrganizationContext(
        new Request("https://functions.example/resolver"),
        { root: null, requestedOrganizationId: "org-b" },
        missing.dependencies,
      ),
    Error,
    "Authentication required",
  );
  assertEquals(missing.factoryCalls, 0);
  assertEquals(missing.calls.length, 0);

  const invalid = fixture({ user: null });
  await assertRejects(
    () =>
      resolveServerOrganizationContext(
        request(),
        { root: null, requestedOrganizationId: "org-b" },
        invalid.dependencies,
      ),
    Error,
    "Authentication required",
  );
  assertEquals(invalid.factoryCalls, 1);
  assertEquals(invalid.calls.length, 0);
});

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

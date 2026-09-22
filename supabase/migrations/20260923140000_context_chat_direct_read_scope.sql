-- New owner-private contexts must not remain directly readable after their
-- department authority is revoked or their project is archived. Legacy
-- engagement conversation sharing keeps its existing contract.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter policy "Owners and active recipients can read Department Chat conversations"
on public.department_chat_conversations
using (
  public.is_team_organization_member(organization_id)
  and (
    (
      owner_id = (select auth.uid())
      and (
        context_kind in ('department_project', 'organization')
        or (
          context_kind = 'department_private'
          and (
            exists (
              select 1 from public.organization_memberships member
              where member.organization_id = department_chat_conversations.organization_id
                and member.user_id = (select auth.uid())
                and member.member_kind = 'team' and member.status = 'active'
                and (
                  member.department_id = department_chat_conversations.department_id
                  or member.role in ('system_owner', 'operations_admin', 'executive')
                )
            )
            or exists (
              select 1 from public.organization_department_memberships department_member
              where department_member.organization_id = department_chat_conversations.organization_id
                and department_member.user_id = (select auth.uid())
                and department_member.department_id = department_chat_conversations.department_id
                and department_member.status = 'active'
            )
          )
        )
        or (
          context_kind = 'project_team'
          and exists (
            select 1 from public.projects project
            where project.id = department_chat_conversations.project_id
              and project.organization_id = department_chat_conversations.organization_id
              and project.archived_at is null
          )
        )
      )
    )
    or (context_kind = 'department_project' and exists (
      select 1 from public.department_chat_conversation_shares share
      join public.organization_memberships membership
        on membership.organization_id = share.organization_id
       and membership.user_id = share.recipient_id
       and membership.member_kind = 'team' and membership.status = 'active'
      join public.engagements engagement
        on engagement.id = share.engagement_id
       and engagement.organization_id = share.organization_id
       and engagement.project_id = share.project_id
       and engagement.status <> 'cancelled'
      join public.projects project
        on project.id = engagement.project_id
       and project.organization_id = engagement.organization_id
       and project.archived_at is null
      join public.engagement_services service
        on service.engagement_id = engagement.id
       and service.organization_id = engagement.organization_id
       and service.status = 'active'
      join public.service_catalog catalog
        on catalog.id = service.service_id
       and catalog.department_id = share.department_id
      where share.conversation_id = department_chat_conversations.id
        and share.organization_id = department_chat_conversations.organization_id
        and share.recipient_id = (select auth.uid()) and share.revoked_at is null
        and (
          membership.department_id = department_chat_conversations.department_id
          or membership.role in ('system_owner', 'operations_admin', 'executive')
        )
    ))
  )
);

alter policy "Owners and active recipients can read Department Chat messages"
on public.department_chat_messages
using (
  public.is_team_organization_member(organization_id)
  and (
    (
      owner_id = (select auth.uid())
      and exists (
        select 1 from public.department_chat_conversations parent
        where parent.id = department_chat_messages.conversation_id
          and parent.organization_id = department_chat_messages.organization_id
          and parent.owner_id = department_chat_messages.owner_id
      )
    )
    or (engagement_id is not null and exists (
      select 1 from public.department_chat_conversation_shares share
      join public.organization_memberships membership
        on membership.organization_id = share.organization_id
       and membership.user_id = share.recipient_id
       and membership.member_kind = 'team' and membership.status = 'active'
      join public.engagements engagement
        on engagement.id = share.engagement_id
       and engagement.organization_id = share.organization_id
       and engagement.project_id = share.project_id
       and engagement.status <> 'cancelled'
      join public.projects project
        on project.id = engagement.project_id
       and project.organization_id = engagement.organization_id
       and project.archived_at is null
      join public.engagement_services service
        on service.engagement_id = engagement.id
       and service.organization_id = engagement.organization_id
       and service.status = 'active'
      join public.service_catalog catalog
        on catalog.id = service.service_id
       and catalog.department_id = share.department_id
      where share.conversation_id = department_chat_messages.conversation_id
        and share.organization_id = department_chat_messages.organization_id
        and share.recipient_id = (select auth.uid()) and share.revoked_at is null
        and (
          membership.department_id = department_chat_messages.department_id
          or membership.role in ('system_owner', 'operations_admin', 'executive')
        )
    ))
  )
);

commit;

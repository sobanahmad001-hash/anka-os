set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare proposal public.project_task_change_proposals%rowtype;
begin
  proposal:=public.create_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',1,'backlog','ready',
    'Work is prepared','No other work affected','No extra cost','a0000000-0000-4000-8000-000000000001');
  if proposal.status<>'pending' or (select status from public.tasks where id=proposal.task_id)<>'backlog' then
    raise exception 'Proposal mutated target before decision'; end if;
  if (public.create_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',1,'backlog','ready',
    'Work is prepared','No other work affected','No extra cost','a0000000-0000-4000-8000-000000000001')).id<>proposal.id then
    raise exception 'Exact replay did not return proposal'; end if;
  begin
    perform public.create_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000001',1,'backlog','done',
      'Work is prepared','No other work affected','No extra cost');
    raise exception 'Changed proposal replay succeeded';
  exception when unique_violation then null; end;
  begin
    update public.project_task_change_proposals set proposed_status='done' where id=proposal.id;
    raise exception 'Direct proposal edit succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
      'b0000000-0000-4000-8000-000000000002',1,'backlog','ready',
      'Other org','No impact','No cost');
    raise exception 'Foreign task proposal succeeded';
  exception when insufficient_privilege then null; end;
  proposal:=public.create_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000001',1,'backlog','blocked',
    'New reason','Work waits','No extra cost',null,'c0000000-0000-4000-8000-000000000001');
  if (select status from public.project_task_change_proposals where id='c0000000-0000-4000-8000-000000000001')<>'superseded'
    or proposal.supersedes_id<>'c0000000-0000-4000-8000-000000000001' then
    raise exception 'Revision did not supersede pending proposal'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',false);
set role service_role;
do $$
declare proposal public.project_task_change_proposals%rowtype;
begin
  begin
    perform public.decide_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000003','approve');
    raise exception 'Unscoped actor approved task change';
  exception when insufficient_privilege then null; end;
  proposal:=public.decide_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002','approve');
  if proposal.status<>'applied' or proposal.applied_row_version<>2
    or (select status from public.tasks where id=proposal.task_id)<>'blocked' then
    raise exception 'Authorized decision did not apply exact task version'; end if;
  proposal:=public.decide_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002','approve');
  if proposal.applied_row_version<>2 or (select row_version from public.tasks where id=proposal.task_id)<>2 then
    raise exception 'Decision replay applied task twice'; end if;
  begin
    perform public.decide_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000002','reject');
    raise exception 'Contradictory decision replay succeeded';
  exception when unique_violation then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$ begin
  perform public.create_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004',
    'b0000000-0000-4000-8000-000000000001',2,'blocked','done',
    'Complete','Ready for review','No cost');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',false);
set role service_role;
do $$
declare proposal public.project_task_change_proposals%rowtype;
begin
  proposal:=public.decide_project_task_change_proposal('00000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002','approve');
  if proposal.status<>'approved_failed' or proposal.failure_reason is null
    or (select status from public.tasks where id=proposal.task_id)<>'blocked' then
    raise exception 'Failed execution was reported as applied'; end if;
end $$;
reset role;
select 'N3 versioned task proposal authority and failed-apply checks passed' as result;

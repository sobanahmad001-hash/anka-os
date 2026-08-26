select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'integration_connection_departments'
order by indexname;

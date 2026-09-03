// Local parser only; never opens a database connection. Run with Deno --no-config --no-lock.
import { parse, parsePlPgSQL } from 'npm:libpg-query@18.1.4'
for (const path of Deno.args) {
  const sql = await Deno.readTextFile(path)
  await parse(sql)
  let count = 0
  for (const match of sql.matchAll(/create (?:or replace )?function[\s\S]*?\$\$[\s\S]*?\$\$/gi)) {
    await parsePlPgSQL(match[0] + ';')
    count++
  }
  for (const match of sql.matchAll(/\bdo \$\$([\s\S]*?)\$\$/gi)) {
    await parsePlPgSQL('create function qts5_parse_block() returns void language plpgsql as $$' + match[1] + '$$;')
    count++
  }
  console.log(path + ': SQL and ' + count + ' PL/pgSQL bodies parsed')
}

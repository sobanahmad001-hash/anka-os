# Website page rankings

Open Plan & Work → Website. Add a planned or existing page, or open a registered Website page. Each saved manual assignment has a primary or supporting role, search intent and locale. The intended URL belongs to the page. “Use saved strategy targets” reads the registered page’s current strategy revision. “No organic target” explicitly suppresses targeting. Project-wide and page views read the same assignments.

## Configure Search Console through Windsor

An operator needs the owner-designated organization, project, Windsor account ID and exact Google Search Console property. Configure the private Edge secret `WINDSOR_GSC_PROJECTS` with the following shape in the deployment’s secret manager. Use a read-only key for the selected account. Keep the value server-side.

```json
{"<project UUID>":{"organization":"<organization UUID>","account":"<Windsor account_id>","site":"<exact URL-prefix or sc-domain property>","key":"<private Windsor API key>"}}
```

Only an explicit **Load rankings** reads Windsor. The reader checks the signed-in user’s project access and derives the URL and queries from the saved page. It filters the response by configured account, property and observed URL, then rechecks the page before returning results. Removing the project entry disables future reads. No schedule or provider data import is created.

Dates select a 1–93 day period and the immediately preceding period of equal length. Country and device use Windsor’s exact returned dimension values. CTR is total clicks divided by total impressions. Average position is impression-weighted and movement is previous position minus selected position. Missing query/URL combinations display “No data”. Search Console may omit anonymized queries. An operator can verify live sync after assigning a property to a specific project and entering its private configuration.

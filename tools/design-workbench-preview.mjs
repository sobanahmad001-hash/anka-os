import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5187, strictPort: true }, plugins: [{
  name: 'offline-design-presentation-only', enforce: 'pre',
  load(id) {
    const path = id.replaceAll('\\', '/').split('?')[0]
    if (path.endsWith('/src/context/OrganizationContext.jsx')) return `import { organization } from '/tools/design-workbench-fixture.js'; export const useOrganization = () => organization;`
    if (path.endsWith('/src/context/AuthContext.jsx')) return `export const useAuth = () => ({user:{id:'preview-user'}});`
    if (path.endsWith('/src/data/departmentChatRepository.js')) return `import { chatRepository } from '/tools/design-workbench-fixture.js'; export const departmentChat = chatRepository;`
    if (path.endsWith('/src/data/designWorkshopRepository.js')) return `import { studio } from '/tools/design-workbench-fixture.js'; export const designWorkshop = { forOrganization: () => studio };`
    if (path.endsWith('/src/data/integrationRepository.js')) return `export const integrations = {listForOrganization: async organization_id => ({organization_id,connections:[]})};`
  },
} ] })
await server.listen()
console.log('OFFLINE fixture preview only: http://127.0.0.1:5187/tools/design-workbench-preview.html')

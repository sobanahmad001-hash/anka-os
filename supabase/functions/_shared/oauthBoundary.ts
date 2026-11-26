/** Denial only: never treat unverified claims as authorization. Existing handlers
 * still validate every non-OAuth credential. OAuth credentials belong to hybrid-mcp. */
export function rejectOAuthClients(handler: (request: Request) => Response | Promise<Response>) {
  return (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    try {
      if (token) {
        const segment = token.split('.')[1]
        const claims = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')))
        if (claims.client_id || claims.role === 'hybrid_mcp') return Response.json({error:'Use the project-scoped ChatGPT connection.'}, {status:403})
      }
    } catch { /* Existing handler validates malformed credentials. */ }
    return handler(request)
  }
}

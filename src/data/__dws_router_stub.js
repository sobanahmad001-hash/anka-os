import { createElement } from 'react'

export function useSearchParams() {
  const query = String(globalThis.__dwsHarness?.search || '')
  return [new URLSearchParams(query), () => {}]
}

export function Link(props) {
  const to = String(props?.to || '')
  return createElement('a', { ...props, href: to }, props?.children)
}

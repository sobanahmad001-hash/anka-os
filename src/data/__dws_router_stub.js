import { createElement, useReducer } from 'react'

export function useSearchParams() {
  const query = String(globalThis.__dwsHarness?.search || '')
  const [, refresh] = useReducer(value => value + 1, 0)
  return [new URLSearchParams(query), next => { globalThis.__dwsHarness.search = new URLSearchParams(next).toString(); refresh() }]
}

export function Link(props) {
  const to = String(props?.to || '')
  return createElement('a', { ...props, href: to }, props?.children)
}

export function useNavigate() {
  return destination => {
    const harness = globalThis.__dwsHarness
    if (harness) (harness.navigations ||= []).push(destination)
  }
}

import { createElement } from 'react'
import DesignDeniedNavigation from './DesignDeniedNavigation.js'

const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function DesignDeniedState({ activeOrganizationId, onChoose }) {
  return createElement('main', {
    className: 'min-h-full bg-slate-950 px-5 py-6 text-slate-100 lg:px-8',
  },
  createElement('div', { className: 'mx-auto mb-5 max-w-3xl' },
    createElement(DesignDeniedNavigation, { activeOrganizationId })),
  createElement('section', {
    role: 'alert',
    className: 'mx-auto max-w-3xl rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] px-6 py-14 text-center',
  },
  createElement('h1', { className: 'font-semibold text-amber-100' }, 'This Design context is unavailable'),
  createElement('p', { className: 'mx-auto mt-2 max-w-xl text-sm leading-6 text-amber-200/80' },
    'The requested work is unavailable in the active organization. No work has been opened and the active organization was not changed.')),
  createElement('div', { className: 'mt-5 flex justify-center' },
    createElement('button', { type: 'button', onClick: onChoose, className: BUTTON }, 'Choose permitted work')))
}

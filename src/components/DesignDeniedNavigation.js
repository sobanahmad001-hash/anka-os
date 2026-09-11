import { createElement } from 'react'
import { Link } from 'react-router-dom'
import { appendWorkshopNavigation } from '../data/workshopNavigation.js'

const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export function deniedDesignWorkshopPath(activeOrganizationId) {
  return appendWorkshopNavigation('/sphere/design', {
    organizationId: activeOrganizationId,
  })
}

export default function DesignDeniedNavigation({ activeOrganizationId }) {
  return createElement(Link, {
    to: deniedDesignWorkshopPath(activeOrganizationId),
    className: BUTTON,
  }, 'Back to Design Workshop')
}

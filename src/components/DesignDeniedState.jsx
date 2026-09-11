import { workspaceReturnTarget } from '../data/workshopNavigation.js'
import _DesignDeniedNavigation from './DesignDeniedNavigation.js'
import _WorkshopContextShell from './WorkshopContextShell.jsx'

const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function DesignDeniedState({ navigation, validation, activeOrganizationId, onChoose }) {
  return (
    <main className="min-h-full bg-slate-950 px-5 py-6 text-slate-100 lg:px-8">
      <div className="mx-auto mb-5 max-w-3xl">
        <_DesignDeniedNavigation activeOrganizationId={activeOrganizationId} />
      </div>
      <_WorkshopContextShell navigation={navigation} validation={validation} returnTarget={workspaceReturnTarget(validation)}>
        <div className="py-24 text-center">
          <p className="font-semibold text-slate-300">This Design context is unavailable</p>
          <p className="mt-1 text-sm text-slate-500">The requested project, engagement, brand, service, or work identity does not match authorized work in the active organization.</p>
        </div>
      </_WorkshopContextShell>
      <div className="flex justify-center">
        <button type="button" onClick={onChoose} className={BUTTON}>Choose permitted work</button>
      </div>
    </main>
  )
}

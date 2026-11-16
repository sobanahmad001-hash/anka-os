import {useSyncExternalStore} from 'react'

const eventName='anka-execution-navigation'
function subscribe(listener){
 globalThis.addEventListener?.('storage',listener)
 globalThis.addEventListener?.(eventName,listener)
 return ()=>{globalThis.removeEventListener?.('storage',listener);globalThis.removeEventListener?.(eventName,listener)}
}
export function useExecutionNavigation(userId){
 const key='anka:execution-navigation:'+userId
 const enabled=useSyncExternalStore(subscribe,()=>globalThis.localStorage?.getItem(key)==='on',()=>false)
 function setEnabled(value){
   globalThis.localStorage?.setItem(key,value?'on':'off')
   globalThis.dispatchEvent?.(new Event(eventName))
 }
 return [enabled,setEnabled]
}

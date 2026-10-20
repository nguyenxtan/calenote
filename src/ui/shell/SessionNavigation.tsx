"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { SessionResponseSchema, type SessionUser } from '@/contracts/api/session';
import { apiRequest, ApiResponseError } from '@/lib/client-api';

const SessionLoaderContext = createContext<(() => Promise<SessionUser>) | null>(null);
const MAX_AGE_MS = 15_000;
async function fetchSession() {
 return SessionResponseSchema.parse({data:await apiRequest('/api/session',{authenticated:true})}).data.user;
}
/** RAM only, owned by the persistent layout. Every data API still authenticates independently. */
export function SessionNavigationProvider({children}:{children:ReactNode}) {
 const state=useRef<{user?:SessionUser;expiresAt:number;pending?:Promise<SessionUser>;generation:number}>({expiresAt:0,generation:0});
 const invalidate=useCallback(()=>{state.current={expiresAt:0,generation:state.current.generation+1};},[]);
 useEffect(()=>{
  const onVisibility=()=>{if(document.visibilityState==='hidden')invalidate();};
  window.addEventListener('calenote-session-changed',invalidate);
  window.addEventListener('pagehide',invalidate);
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{invalidate();window.removeEventListener('calenote-session-changed',invalidate);window.removeEventListener('pagehide',invalidate);document.removeEventListener('visibilitychange',onVisibility);};
 },[invalidate]);
 const load=useCallback(function readSession():Promise<SessionUser>{
  const current=state.current;
  if(current.user && current.expiresAt>Date.now())return Promise.resolve(current.user);
  if(current.pending)return current.pending;
  const pending=fetchSession().then(user=>{
   if(state.current.generation!==current.generation)return readSession();
   state.current={user,expiresAt:Date.now()+MAX_AGE_MS,generation:current.generation};return user;
  }).finally(()=>{if(state.current.pending===pending)state.current.pending=undefined;});
  current.pending=pending;return pending;
 },[]);
 return <SessionLoaderContext.Provider value={load}>{children}</SessionLoaderContext.Provider>;
}
export function useSessionLoader(){
 const shared=useContext(SessionLoaderContext);
 return useCallback(async(onUnauthorized?:()=>void)=>{
  try{return await (shared??fetchSession)();}
  catch(error){if(error instanceof ApiResponseError && error.status===401)onUnauthorized?.();throw error;}
 },[shared]);
}

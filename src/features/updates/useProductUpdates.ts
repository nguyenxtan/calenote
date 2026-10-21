"use client";
import {useEffect,useState} from 'react';
import {apiRequest,ApiResponseError} from '@/lib/client-api';
import {ProductUpdatesSchema} from '@/contracts/api/product-updates';
import type {z} from 'zod';
/** Never announce unreleased assets: only the currently serving Worker supplies notes. */
export function useProductUpdates(includeRuntime=false){
 const [data,setData]=useState<z.infer<typeof ProductUpdatesSchema>|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>{
  let active=true,generation=0,pending:AbortController|null=null;
  async function refresh(){
   if(pending||document.visibilityState==='hidden')return;
   const controller=new AbortController(),epoch=generation;pending=controller;
   try{const value=ProductUpdatesSchema.parse(await apiRequest(includeRuntime?'/api/product-updates/runtime':'/api/product-updates',{authenticated:true,signal:controller.signal}));if(active&&epoch===generation){setData(value);setError(false);}}
   catch(reason){if(active&&epoch===generation){if(reason instanceof ApiResponseError&&(reason.status===401||reason.status===403))setData(null);setError(true);}}
   finally{if(pending===controller)pending=null;}
  }
  // Do not immediately refetch: apiRequest itself emits this event on401.
  const invalidate=()=>{generation++;pending?.abort();pending=null;setData(null);setError(true);};
  void refresh();
  const onVisible=()=>{void refresh();};
  const timer=setInterval(onVisible,60_000);
  window.addEventListener('focus',onVisible);document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('calenote-session-changed',invalidate);
  return()=>{active=false;pending?.abort();clearInterval(timer);window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('calenote-session-changed',invalidate);};
 },[includeRuntime]);
 return{data,error};
}

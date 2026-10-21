// Standalone metadata preflight. Run before preparing any future paid grant.
// No arguments, keys, authorization headers, inference URL, retry or fallback.
import {fetchPinnedPublicRoute} from './context-public-route.ts';
if(process.argv.length!==2)throw Error('PUBLIC_ROUTE_ARGUMENT_SCOPE');
const result=await fetchPinnedPublicRoute();
console.log(JSON.stringify(result));
process.exitCode=result.status==='ADVERTISED'?0:2;

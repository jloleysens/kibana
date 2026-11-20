/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { getJsSourceSync } from '@kbn/peggy';

it('retries expired bearers for the original Kibana AND Security handlers through the shared worker refresh hook', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-http-refresh-'));
  const file = join(directory, 'probe.cjs');
  const source = (path: string) => JSON.stringify(resolve(path));
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'ts',
        contents: `
        import assert from 'node:assert/strict';
        import {NativeKibanaHttp} from ${source(
          'src/platform/plugins/shared/workflows_execution_engine/server/remote/native_kibana_http'
        )};
        import {WorkerHttpProvider} from ${source(
          'src/core/packages/http/server-internal/src/worker_http_provider'
        )};
        import {KibanaActionStepImpl} from ${source(
          'src/platform/plugins/shared/workflows_execution_engine/server/step/kibana_action_step'
        )};
        import {CreateNoteStep} from ${source(
          'x-pack/solutions/security/plugins/security_solution/server/workflows/step_types/create_note_step/create_note_step_runtime'
        )};
        const config = {target:'local',basePath:'',kibanaVersion:'9.7.0',maxRedirects:0,
          serverInfo:{name:'worker',hostname:'127.0.0.1',port:5635,protocol:'http'},
          ssl:Object.fromEntries(['local','public'].map(target=>[target,{verificationMode:'full',certificateAuthorities:[],exclusiveTrust:false,clientCertificateRequired:false}]))};
        const results=[];
        const run=async (family, failRefresh) => {
          const requests=[];let refreshes=0;
          global.fetch=async request=>{
            const auth=request.headers.get('authorization');
            requests.push({auth});
            if(auth==='Bearer essu_expired')return new Response('{}',{status:401,headers:{'content-type':'application/json','x-kbn-self-call-auth-challenge':'true'}});
            assert.equal(auth,'Bearer essu_fresh');
            return new Response(JSON.stringify({id:'case-refreshed',note:{noteId:'note-refreshed'}}),{headers:{'content-type':'application/json'}});
          };
          const refresh=async()=>{refreshes++;if(failRefresh)throw new Error('refresh unavailable');return {authorization:'Bearer essu_fresh',uiamAttestation:'fresh-bound'};};
          const http=new NativeKibanaHttp({config,authorization:'Bearer essu_expired',eventChainHeaders:{}},'default','run',new WorkerHttpProvider(),refresh);
          let succeeded=false;let status;
          try {
            if(family==='kibana'){
              const node={stepId:'request',stepType:'kibana.request',configuration:{type:'kibana.request',with:{method:'GET',path:'/api/cases'}}};
              const logger={logInfo(){},logWarn(){},logError(){}};
              const runtime={node,workflowExecution:{id:'run'},abortController:new AbortController(),getStepTimeoutMs:()=>1000,
                contextManager:{getWorkflowSpaceId:()=> 'default',getDependencies:()=>({dispatchFacts:{maxResponseSizeBytes:1024}})}};
              const step=new KibanaActionStepImpl(node,runtime,{},logger,params=>http.call(params),null);
              const result=await step._run();
              succeeded=!result.error;status=result.error?.details?.status;
              if(succeeded)assert.equal(result.output.id,'case-refreshed');
            } else {
              const output=await new CreateNoteStep().run('scope',{}, {handlerContext:{input:{text:'note',document_id:'document'},contextManager:{callKibanaApi:params=>http.call(params)}}});
              assert.equal(output.output.note_id,'note-refreshed');succeeded=true;
            }
          }catch(error){status=error.details?.status;}
          finally{await http.close();}
          assert.equal(succeeded,!failRefresh);
          assert.equal(refreshes,1);
          assert.equal(requests.length,failRefresh?1:2);
          if(failRefresh)assert.equal(status,401);
          results.push({family,failRefresh,succeeded,refreshes,requests:requests.length});
        };
        (async()=>{for(const family of ['kibana','security']){await run(family,false);await run(family,true);}console.log(JSON.stringify(results));})().catch(error=>{console.error(error);process.exitCode=1;});
      `,
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: file,
      plugins: [
        {
          name: 'peggy',
          setup(bundler) {
            bundler.onLoad({ filter: /\.peggy$/ }, ({ path }) => ({
              contents: getJsSourceSync({
                path,
                content: readFileSync(path, 'utf8'),
                format: 'commonjs',
              }).source,
              loader: 'js',
            }));
          },
        },
      ],
    });
    const output = JSON.parse(execFileSync(process.execPath, [file], { encoding: 'utf8' }));
    expect(output).toHaveLength(4);
    expect(output.filter((result: { succeeded: boolean }) => result.succeeded)).toHaveLength(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

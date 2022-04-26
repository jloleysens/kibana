/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */
import * as Rx from 'rxjs';
import { promises as fs } from 'fs';
import { take, share, tap, takeUntil, map, switchMap, ignoreElements } from 'rxjs/operators';
import { ByteSizeValue } from '@kbn/config-schema';
import { observeLines } from '@kbn/stdio-dev-helpers';
import Path from 'path';
import { REPO_ROOT } from '@kbn/utils';
import { duration } from 'moment';
import { BasePathProxyServer } from './proxy_server';
import { HttpConfig } from './proxy_server_config';
import { usingServerProcess } from './using_server_process';

export class KibanaMon {
  proxyServer: BasePathProxyServer;
  subscription: undefined | Rx.Subscription;

  processExit$ = Rx.fromEvent<void>(process, 'exit');
  sigterm$ = Rx.fromEvent<void>(process, 'SIGTERM');

  restart$ = new Rx.Observable();

  currentVersion: 'v1' | 'v2' = 'v1';

  kibanaPort = 55000;

  constructor() {
    this.proxyServer = new BasePathProxyServer(
      {},
      new HttpConfig({
        cors: {
          allowCredentials: true,
          allowOrigin: ['*'],
          enabled: false,
        },
        host: 'localhost',
        keepaliveTimeout: 30000,
        maxPayload: new ByteSizeValue(1024 * 1024 * 1024),
        port: 5601,
        shutdownTimeout: duration(30, 'seconds'),
        socketTimeout: 30000,
        ssl: {} as any,
      }),
      {},
      () => {
        this.upgrade();
      },
      this.kibanaPort
    );
  }

  /**
   * Very hacky upgrade process
   *
   * In production builds this could be much better:
   *
   * 1. Set a "current" Kibana
   * 2. Put Kibana inside a folder with its build nr
   * 3. Download upgrade to Kibana folder with build nr
   * 4. Point "current" to new Kibana
   */
  private async upgrade() {
    this.stop();
    const liveDir = Path.resolve(__dirname, '../src/plugins');
    console.log('cleaning out', Path.resolve(__dirname, '../src/plugins'), '...');
    await fs.rm(liveDir, { recursive: true, force: true });
    console.log('copying new code to', Path.resolve(__dirname, '../src/plugins'), '...');
    await fs.cp(Path.resolve(__dirname, '../v2/plugins'), liveDir, {
      recursive: true,
      force: true,
    });
    this.bootstrap();
  }

  private run$ = new Rx.Observable<void>((subscriber) => {
    // force unsubscription/kill on process.exit or SIGTERM
    subscriber.add(
      Rx.merge(this.processExit$, this.sigterm$).subscribe(() => {
        subscriber.complete();
      })
    );

    console.log(process.argv.slice(2).filter((arg) => arg !== '--upgradeable'));

    const serverOptions = {
      script: Path.resolve(REPO_ROOT, 'scripts/kibana'),
      argv: [
        ...process.argv.slice(2).filter((arg) => arg !== '--upgradeable'),
        ...[`--server.port=${this.kibanaPort}`],
      ],
      forceColor: true,
    };
    const runServer = () =>
      usingServerProcess(serverOptions, (proc) => {
        // observable which emits devServer states containing lines
        // logged to stdout/stderr, completes when stdio streams complete
        const log$ = Rx.merge(observeLines(proc.stdout!), observeLines(proc.stderr!)).pipe(
          tap((observedLine) => {
            console.log(observedLine);
          })
        );

        // observable which emits exit states and is the switch which
        // ends all other merged observables
        const exit$ = Rx.fromEvent<[number]>(proc, 'exit').pipe(
          tap(([code]) => {
            if (code != null && code !== 0) {
              throw new Error(`server crashed with exit code [${code}]`);
            }
          }),
          take(1),
          share()
        );

        // throw errors if spawn fails
        const error$ = Rx.fromEvent<Error>(proc, 'error').pipe(
          map((error) => {
            throw error;
          }),
          takeUntil(exit$)
        );

        // handles messages received from the child process
        const msg$ = Rx.fromEvent<[any]>(proc, 'message').pipe(
          tap(([received]) => {
            if (!Array.isArray(received)) {
              return;
            }

            const msg = received[0];

            if (msg === 'SERVER_LISTENING') {
              console.log('kibana is ready to accept requests');
            }
          }),
          takeUntil(exit$)
        );

        return Rx.merge(log$, exit$, error$, msg$);
      });

    subscriber.add(
      Rx.concat([undefined], this.restart$)
        .pipe(
          // on each tick unsubscribe from the previous server process
          // causing it to be SIGKILL-ed, then setup a new one
          switchMap(runServer),
          ignoreElements()
        )
        .subscribe(subscriber)
    );
  });

  public bootstrap() {
    console.log('calling bootstrap');
    if (this.subscription) {
      throw new Error('already bootstrapped!');
    }
    this.subscription = new Rx.Subscription();
    this.subscription.add(
      this.run$
        .pipe(
          tap({
            complete: () => {
              // when the devServer gracefully exits because of an exit signal stop the cli dev mode to trigger full shutdown
              this.stop();
            },
          })
        )
        .subscribe()
    );

    console.log('starting proxy server');

    this.proxyServer
      .start({
        delayUntil: () => {
          return Rx.EMPTY;
        },
        shouldRedirectFromOldBasePath: () => false,
      })
      .then(() => console.log('started proxy server'));

    this.subscription.add(() => this.proxyServer.stop());
  }

  public stop() {
    console.log('stopping Kibana!');
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// import { resolve } from 'path';
import { Duplex } from 'stream';
import { promises as fs } from 'fs';
import { encodePNGToStream } from 'pureimage';
// eslint-disable-next-line
import * as _pdfjs from 'pdfjs-dist/legacy/build/pdf';
const pdfjs: typeof import('pdfjs-dist') = _pdfjs;

import { CanvasFactory } from './canvas_factory';

// const pathToCmaps = resolve(
//   __dirname,
//   '..',
//   '..',
//   '..',
//   '..',
//   '..',
//   './node_modules/pdfjs-dist/cmaps'
// );

/**
 * Forked from implementation in https://github.com/k-yle/pdf-to-img.
 *
 * Replaces usage of node canvas with pureimage to avoid introducing
 * a native dependency.
 *
 * Converts a PDF to a series of images. This returns a `Symbol.asyncIterator`
 *
 * @param input Either (a) the path to a pdf file, or (b) a data url, or (c) a buffer, or (d) a ReadableStream.
 *
 * @example
 * ```js
 *
 * for await (const page of await pdf("example.pdf")) {
 *   expect(page).toMatchImageSnapshot();
 * }
 *
 * // or if you want access to more details:
 *
 * const doc = await pdf("example.pdf");
 * expect(doc.length).toBe(1);
 * expect(doc.metadata).toEqual({ ... });
 *
 * for await (const page of doc) {
 *   expect(page).toMatchImageSnapshot();
 * }
 * ```
 */
export async function pdfToPng(pathToPdf: string): Promise<{
  length: number;
  [Symbol.asyncIterator](): AsyncIterator<Buffer, void, void>;
}> {
  const pdfDocument = await pdfjs.getDocument({
    // cMapUrl: pathToCmaps, // TODO: this feels hacky
    // cMapPacked: true,
    data: await fs.readFile(pathToPdf),
  }).promise;

  return {
    length: pdfDocument.numPages,
    [Symbol.asyncIterator]() {
      return {
        pg: 0,
        async next(this: { pg: number }) {
          while (this.pg < pdfDocument.numPages) {
            this.pg += 1;
            const page = await pdfDocument.getPage(this.pg);

            const viewport = page.getViewport({ scale: 1 });

            const canvasFactory = new CanvasFactory();

            const { canvas, context: canvasContext } = canvasFactory.create(
              viewport.width,
              viewport.height
            );

            await page.render({
              canvasContext,
              viewport,
              canvasFactory,
            }).promise;

            const pngStream = new Duplex();
            await encodePNGToStream(canvas, pngStream);
            const bufferChunks = [];
            for await (const pngBufferChunk of pngStream) {
              bufferChunks.push(pngBufferChunk);
            }

            return { done: false, value: Buffer.concat(bufferChunks) };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

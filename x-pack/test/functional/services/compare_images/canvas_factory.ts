/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'assert';
import * as PImage from 'pureimage';
import type { Bitmap } from 'pureimage/types/bitmap';
import type { Context } from 'pureimage/types/context';

interface MyCanvas {
  canvas: null | Bitmap;
  context: null | Context;
}

/**
 * Implements BaseCanvasFactory from 'pdfjs-dist/types/src/display/display_utils'.
 *
 * However, that type is not really overridable...
 */
export class CanvasFactory {
  create(width: number, height: number) {
    const canvas = PImage.make(width, height);
    const context = canvas.getContext('2d');

    return {
      canvas,
      context: new Proxy(context, {
        get: (target, prop) => {
          if (prop === 'canvas') {
            return canvas;
          }
          const val = target[prop as keyof Context];
          if (typeof val === 'function') {
            console.log('returning my function for', prop);
            return val.bind(context);
          }

          return target[prop as keyof Context];
        },
      }),
    };
  }

  reset(myCanvas: MyCanvas, width: number, height: number): void {
    assert(myCanvas?.canvas, 'Expected myCanvas to have a canvas!');
    myCanvas.canvas.width = width;
    myCanvas.canvas.height = height;
  }

  destroy(myCanvas: MyCanvas): void {
    myCanvas.context = null;
    myCanvas.canvas = null;
  }
}

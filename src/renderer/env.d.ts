import type { MyLoadApi } from '../shared/types';

declare global {
  interface Window {
    myload: MyLoadApi;
  }
}

export {};


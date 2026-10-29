import {describe,it,expect} from "vitest";
import {d1Changes} from "./types";
describe("D1 target mutation count",()=>{
  it("uses RETURNING target rows when trigger writes inflate D1 changes",()=>{
    expect(d1Changes({results:[{id:"owned"}],meta:{changes:3}} as unknown as D1Result<unknown>)).toBe(1);
  });
  it("preserves multi-target and non-returning counts",()=>{
    expect(d1Changes({results:[{id:"a"},{id:"b"}],meta:{changes:5}} as unknown as D1Result<unknown>)).toBe(2);
    expect(d1Changes({results:[],meta:{changes:0}} as unknown as D1Result<unknown>)).toBe(0);
    expect(d1Changes({results:[],meta:{changes:1}} as unknown as D1Result<unknown>)).toBe(1);
  });
});

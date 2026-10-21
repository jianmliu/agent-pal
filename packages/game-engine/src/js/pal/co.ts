/**
 * Minimal typed port of co-like coroutine runner.
 */
type GeneratorFunctionLike = (...args: any[]) => Generator<any, any, any>;
type GeneratorLike = Generator<any, any, any>;

function co(gen: GeneratorFunctionLike | GeneratorLike, ctx?: unknown): Promise<any> {
  const boundCtx: any = ctx;
  if (typeof gen === 'function') {
    gen = (gen as GeneratorFunctionLike).call(boundCtx);
  }
  return new Promise((resolve, reject) => {
    onFulfilled(undefined);
    function onFulfilled(res: any) {
      let ret: IteratorResult<any, any>;
      try {
        ret = (gen as GeneratorLike).next(res);
      } catch (err) {
        reject(err);
        return;
      }
      next(ret);
    }
    function onRejected(err: any) {
      let ret: IteratorResult<any, any>;
      try {
        ret = (gen as GeneratorLike).throw!(err);
      } catch (error) {
        reject(error);
        return;
      }
      next(ret);
    }
    function next(ret: IteratorResult<any, any>) {
      if (ret.done) {
        resolve(ret.value);
        return;
      }
      const value = toPromise.call(boundCtx, ret.value);
      if (value && isPromise(value)) {
        value.then(onFulfilled, onRejected);
      } else {
        onRejected(new TypeError('You may only yield a function, promise, generator, array, or object, but the following object was passed: "' + String(ret.value) + '"'));
      }
    }
  });
}

co.wrap = function(fn: GeneratorFunctionLike) {
  createPromise.__generatorFunction__ = fn;
  return createPromise;
  function createPromise(this: any, ...args: any[]) {
    return co.call(this, fn.apply(this, args));
  }
};

export default co as any;

function isPromise(obj: any): obj is Promise<any> {
  return obj && typeof obj.then === 'function';
}

function toPromise(this: any, obj: any): any {
  if (!obj) return obj;
  if (isPromise(obj)) return obj;
  if (typeof obj === 'function') return thunkToPromise.call(this, obj);
  if (isGenerator(obj) || isGeneratorFunction(obj)) return co.call(this, obj);
  if (Array.isArray(obj)) return Promise.all(obj.map(toPromise, this));
  if (isObject(obj)) return objectToPromise.call(this, obj);
  return obj;
}

function thunkToPromise(this: any, fn: Function): Promise<any> {
  const ctx: any = this;
  return new Promise((resolve, reject) => {
    fn.call(ctx, function(err: any, ...args: any[]) {
      if (err) return reject(err);
      if (args.length > 1) return resolve(args);
      return resolve(args[0]);
    });
  });
}

function objectToPromise(obj: Record<string, any>): Promise<any> {
  const results: Record<string, any> = Array.isArray(obj) ? [] : {};
  const promises = Object.keys(obj).map((key) => {
    const promise = toPromise(obj[key]);
    if (promise && isPromise(promise)) {
      return promise.then((res) => {
        results[key] = res;
      });
    }
    results[key] = obj[key];
    return null;
  }).filter(Boolean) as Promise<any>[];
  return Promise.all(promises).then(() => results);
}

function isGenerator(obj: any): obj is GeneratorLike {
  return obj && typeof obj.next === 'function' && typeof obj.throw === 'function';
}

function isGeneratorFunction(obj: any): boolean {
  const constructor = obj && obj.constructor;
  if (!constructor) return false;
  return constructor.name === 'GeneratorFunction' || constructor.displayName === 'GeneratorFunction';
}

function isObject(obj: any): obj is Record<string, any> {
  return obj && Object.prototype.toString.call(obj) === '[object Object]';
}

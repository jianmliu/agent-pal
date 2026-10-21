const trace = typeof window !== 'undefined'
  && (window as any).PAL_DEBUG
  && (window as any).PAL_DEBUG.traceModules
  ? console.trace.bind(console)
  : () => {};

export default trace;

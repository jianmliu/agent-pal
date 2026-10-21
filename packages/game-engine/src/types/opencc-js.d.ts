declare module 'opencc-js' {
  interface ConverterOptions {
    from: string;
    to: string;
  }

  interface Converter {
    (text: string): string;
  }

  const OpenCC: {
    Converter(options: ConverterOptions): Converter;
  };

  export default OpenCC;
}

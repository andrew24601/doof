declare module "plist" {
  export function parse(xml: string): unknown;
  export function build(value: unknown): string;

  const plist: {
    parse: typeof parse;
    build: typeof build;
  };

  export default plist;
}
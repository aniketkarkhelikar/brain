declare module 'html-to-text' {
  export function convert(
    html: string,
    options?: {
      wordwrap?: boolean;
      selectors?: Array<{
        selector: string;
        format?: string;
        options?: { ignoreHref?: boolean };
      }>;
    },
  ): string;
}

// The package ships no TypeScript declarations. Only the consumed API is declared.
declare module 'geoip-country' {
  export function lookup(ip: string): { country: string } | null;
}

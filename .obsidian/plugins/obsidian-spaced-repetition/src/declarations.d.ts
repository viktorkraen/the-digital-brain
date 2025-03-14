declare module "pagerank.js";

declare module '*.wasm' {
    const content: string;
    export default content;
}

declare module '*.worker.js' {
    const content: string;
    export default content;
}

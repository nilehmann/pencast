declare module "interactive-shape-recognition" {
    export default function detectShape(
        points: [number, number][],
    ): { shape: "LINE" | "RECTANGLE" | "CIRCLE" | "UNKNOWN" };
}

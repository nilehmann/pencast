import detectShape from "interactive-shape-recognition";
import type { NormalizedPoint } from "@pencast/shared/types";

export interface RecognizedShape {
    tool: "line" | "box";
    points: [NormalizedPoint, NormalizedPoint];
}

export function recognizeShape(
    points: NormalizedPoint[],
): RecognizedShape | null {
    if (points.length < 3) return null;

    const coords: [number, number][] = points.map((p) => [p.normX, p.normY]);
    const { shape } = detectShape(coords);

    if (shape === "LINE") {
        const first = points[0];
        const last = points[points.length - 1];
        return {
            tool: "line",
            points: [
                { normX: first.normX, normY: first.normY },
                { normX: last.normX, normY: last.normY },
            ],
        };
    }

    if (shape === "RECTANGLE") {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        for (const p of points) {
            if (p.normX < minX) minX = p.normX;
            if (p.normY < minY) minY = p.normY;
            if (p.normX > maxX) maxX = p.normX;
            if (p.normY > maxY) maxY = p.normY;
        }
        return {
            tool: "box",
            points: [
                { normX: minX, normY: minY },
                { normX: maxX, normY: maxY },
            ],
        };
    }

    return null;
}

export function assertSeriesDeliveryDuration(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("无法读取有效的成片时长");
}

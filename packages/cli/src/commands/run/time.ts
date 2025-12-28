export function formatDuration(ms: number): string {
    if (ms < 0) return '0s';
    
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)));

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return parts.join(' ');
}

export function calculateEta(startTime: number, percentage: number): string {
    if (percentage <= 0 || percentage >= 100) return '--';
    
    const elapsed = Date.now() - startTime;
    const totalEstimated = elapsed / (percentage / 100);
    const remaining = totalEstimated - elapsed;
    
    return formatDuration(remaining);
}

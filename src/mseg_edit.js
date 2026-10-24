// Shared MSEG point editing for Better Shaper and Better Sampler.
// A selection box picks every point whose centre lies inside the rectangle.
// Dragging a selection moves it as a group, and a point swept over is deleted.

// Drops selected points that are not the curve's two ends. Returns the kept points, or null when nothing changes.
function msegDeleteSelection(points, selectedIds) {
    if (!points || points.length <= 2 || !selectedIds || !selectedIds.length) return null;
    var firstId = points[0].id;
    var lastId = points[points.length - 1].id;
    var hasInterior = false;
    var i;
    for (i = 0; i < points.length; i++) {
        var pt = points[i];
        if (pt.id !== firstId && pt.id !== lastId && selectedIds.indexOf(pt.id) !== -1) hasInterior = true;
    }
    if (!hasInterior) return null;
    return points.filter(function (ptf) {
        if (ptf.id === firstId || ptf.id === lastId) return true;
        return selectedIds.indexOf(ptf.id) === -1;
    });
}

function msegMarqueeRect(x0, y0, x1, y1) {
    return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
}

function msegSelectInRect(points, rect, toScreen, baseIds) {
    var rx = rect[0], ry = rect[1], rw = rect[2], rh = rect[3];
    var newSel = baseIds ? baseIds.slice() : [];
    var i;
    for (i = 0; i < points.length; i++) {
        var sc = toScreen(points[i].x, points[i].y);
        if (sc[0] >= rx && sc[0] <= rx + rw && sc[1] >= ry && sc[1] <= ry + rh) {
            if (newSel.indexOf(points[i].id) === -1) newSel.push(points[i].id);
        }
    }
    return newSel;
}

// Moves every selected point by the primary point's delta. Endpoints stay at x = 0 and x = 1.
// An unselected point whose x lies on a selected point's travel is removed.
function msegMoveSelection(points, selectedIds, startMap, primaryId, targetX, targetY, loopLink) {
    var primaryStart = startMap[primaryId];
    if (!primaryStart) return points;
    var dx = targetX - primaryStart.x;
    var dy = targetY - primaryStart.y;
    var minInteriorX = 1.0, maxInteriorX = 0.0, hasInterior = false;
    var i;
    for (i = 0; i < selectedIds.length; i++) {
        var st = startMap[selectedIds[i]];
        if (st && !st.isFirst && !st.isLast) {
            hasInterior = true;
            if (st.x < minInteriorX) minInteriorX = st.x;
            if (st.x > maxInteriorX) maxInteriorX = st.x;
        }
    }
    if (hasInterior) {
        if (minInteriorX + dx < 0.0005) dx = 0.0005 - minInteriorX;
        if (maxInteriorX + dx > 0.9995) dx = 0.9995 - maxInteriorX;
    }
    var sweepIntervals = [];
    for (i = 0; i < points.length; i++) {
        var pt = points[i];
        if (selectedIds.indexOf(pt.id) === -1) continue;
        var stj = startMap[pt.id];
        if (!stj) continue;
        var prevX = pt.x;
        var newY = Math.max(0.0, Math.min(1.0, stj.y + dy));
        pt.y = newY;
        if (stj.isFirst) {
            pt.x = 0.0;
            if (loopLink && points.length >= 2) points[points.length - 1].y = newY;
        } else if (stj.isLast) {
            pt.x = 1.0;
            if (loopLink && points.length >= 2) points[0].y = newY;
        } else {
            var newX = Math.max(0.0005, Math.min(0.9995, stj.x + dx));
            pt.x = newX;
            sweepIntervals.push([Math.min(prevX, newX) - 0.002, Math.max(prevX, newX) + 0.002]);
            sweepIntervals.push([Math.min(stj.x, newX) - 0.002, Math.max(stj.x, newX) + 0.002]);
        }
    }
    if (sweepIntervals.length >= 2) {
        var minSpan = 1.0, maxSpan = 0.0;
        for (i = 0; i < sweepIntervals.length; i++) {
            if (sweepIntervals[i][0] < minSpan) minSpan = sweepIntervals[i][0];
            if (sweepIntervals[i][1] > maxSpan) maxSpan = sweepIntervals[i][1];
        }
        sweepIntervals.push([minSpan, maxSpan]);
    }
    if (sweepIntervals.length > 0) {
        points = points.filter(function (ptf) {
            var ptSt = startMap[ptf.id];
            if (ptSt && (ptSt.isFirst || ptSt.isLast)) return true;
            if (selectedIds.indexOf(ptf.id) !== -1) return true;
            var k;
            for (k = 0; k < sweepIntervals.length; k++) {
                if (ptf.x >= sweepIntervals[k][0] && ptf.x <= sweepIntervals[k][1]) return false;
            }
            return true;
        });
    }
    return points;
}

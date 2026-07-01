function contiguousRanges(pages: number[]) {
  const sortedPages = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: Array<{ end: number; start: number }> = [];

  for (const page of sortedPages) {
    const lastRange = ranges.at(-1);
    if (lastRange && page === lastRange.end + 1) {
      lastRange.end = page;
      continue;
    }

    ranges.push({
      end: page,
      start: page,
    });
  }

  return ranges;
}

export function formatSourcePages(pages: number[]) {
  if (pages.length === 0) {
    return "";
  }

  const ranges = contiguousRanges(pages);

  if (ranges.length === 1 && ranges[0].start === ranges[0].end) {
    return `p. ${ranges[0].start}`;
  }

  return `pp. ${ranges
    .map((range) =>
      range.start === range.end ? String(range.start) : `${range.start}-${range.end}`,
    )
    .join(", ")}`;
}

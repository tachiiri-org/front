export const formatTimestampDisplay = (value: string | null): string => {
  if (!value) {
    return 'Pending';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('.000Z', 'Z');
};

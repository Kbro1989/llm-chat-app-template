export async function generateLore(lat: number, lon: number) {
  const location = `Lat: ${lat}, Lon: ${lon}`;
  const lore = `At ${location}, the rift between realities hums with ancient echoes...`;
  return lore;
}

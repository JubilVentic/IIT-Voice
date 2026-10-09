export async function currentLocation(geolocation, onRetry) {
  const request = options => new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, options));
  try {
    return await request({ enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  } catch (error) {
    if (![2, 3].includes(error.code)) throw error;
    onRetry();
    return request({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
}

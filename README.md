# SOS Wear

Aplicación local de botón SOS para Wear OS con ubicación en tiempo real. El reloj envía las coordenadas al backend Express del PC; el dashboard las representa sobre OpenStreetMap.

## Requisitos

- JDK 21 Temurin: `C:\Users\Vlad-pc\.jdks\temurin-21.0.12.1`
- Android Studio y Android SDK configurados.
- Un emulador **Wear OS Small Round, API 34** con conectividad Wi-Fi.
- Node.js 20 o posterior y npm.
- Conexión a Internet para cargar los mosaicos de OpenStreetMap en el dashboard.

Gradle fija el JDK 21 del proyecto en `gradle.properties`. El backend y el dashboard se ejecutan localmente; las ubicaciones no se guardan en una base de datos y se borran al reiniciar el backend.

## Abrir y ejecutar la app

1. Abre la carpeta raíz del proyecto en Android Studio.
2. Espera a que termine la sincronización de Gradle.
3. Selecciona el emulador Wear OS Small Round API 34 y ejecuta la configuración `app`.
4. Concede el permiso de ubicación precisa cuando la app lo solicite. Permite notificaciones para ver el aviso persistente del SOS.

## Iniciar el backend y abrir el dashboard

En PowerShell, desde la raíz del proyecto:

```powershell
cd backend
npm install
npm start
```

El servidor escucha en el puerto `3000` y anuncia `http://0.0.0.0:3000`. En el navegador del PC, abre:

```text
http://localhost:3000/dashboard
```

Al iniciar el proceso, la lista de emergencias comienza vacía. El dashboard consulta el backend cada dos segundos; muestra el marcador activo, su ubicación y las emergencias finalizadas durante esa ejecución. Reiniciar el backend borra ambas listas.

La URL configurada por defecto en el reloj es `http://10.0.2.2:3000`, que apunta al PC desde el emulador Android. Para que el reloj pueda conectarse, deja el backend en ejecución y activa Wi-Fi en el emulador:

```powershell
adb devices
adb -s emulator-5554 shell svc wifi enable
```

Si ADB muestra otro serial, sustituye `emulator-5554` por el correspondiente. Puedes comprobar la conectividad con:

```powershell
adb -s emulator-5554 shell ip route
```

La tabla debe mostrar una ruta de red. Sin Wi-Fi o ruta disponible, el reloj no podrá acceder a `10.0.2.2`.

## Simular una ruta GPS

1. Arranca el emulador Wear OS y abre **Extended Controls** (`…`) desde la ventana del emulador.
2. Abre **Location**, importa el archivo [`test/ruta_prueba.gpx`](test/ruta_prueba.gpx) como ruta GPX y pulsa **Play** para reproducirla.
3. Si Extended Controls ofrece una velocidad de reproducción, elige una que permita observar la actualización del mapa.
4. Inicia SOS desde el reloj y comprueba que las coordenadas y el marcador cambian en el dashboard.

La ruta de prueba recorre un tramo corto del centro de Ciudad de México.

En la demo se fijó la ubicación en la UTSLRC (San Luis Río Colorado) con: adb emu geo fix -114.71727561714322 32.43786004187378

## Ejemplo de POST `/api/sos`

El backend acepta JSON con ID, nombre, latitud, longitud, marca temporal ISO 8601 y precisión opcional. Por ejemplo, desde PowerShell:

```powershell
$json = '{"id":"prueba-manual-01","name":"Usuario de prueba","lat":19.4326,"lng":-99.1332,"accuracy":8,"timestamp":"2026-10-19T12:00:00.000Z"}'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sos -ContentType 'application/json' -Body $json
```

La respuesta creada contiene `status: "active"`. El dashboard consume `GET /api/sos/active`, que devuelve los arreglos `emergencies` y `finalized`.

## Si no compila en otra máquina

En Android Studio, abre **Settings > Build Tools > Gradle > Gradle JDK** y selecciona **JDK 21** (no JDK 25). Instala también el SDK de Android que requiera el proyecto desde el SDK Manager.

## Checklist de pruebas

- [ ] **Permiso denegado:** deniega ubicación precisa e inicia SOS. La app debe explicar que necesita el permiso y no empezar el rastreo.
- [ ] **Cancelar cuenta regresiva:** pulsa SOS y luego **CANCELAR** antes de que transcurran cinco segundos. No debe aparecer una emergencia en el dashboard.
- [x] **SOS completo:** activa Wi-Fi, inicia el backend, reproduce la ruta GPX y confirma que el dashboard muestra el dispositivo y actualiza sus coordenadas.
- [ ] **Backend apagado y reconectado:** inicia SOS con el backend detenido. La app debe indicar el error de conexión y reintentar; arranca el backend y comprueba que se sincronizan las ubicaciones.
- [x] **Detener SOS:** pulsa **Detener SOS** en el reloj. El dashboard debe conservar el registro, mostrar **Finalizada** y retirar el dispositivo de los activos.
- [x] **Ubicación en el mapa:** comprueba que el marcador se desplaza suavemente y el mapa enfoca/ajusta el zoom al dispositivo activo.
- [ ] **Backend reiniciado:** detén y vuelve a arrancar Node.js. El dashboard debe comenzar vacío y sin emergencias de ejecuciones anteriores.

## Pruebas y compilación

Desde la raíz del proyecto, en PowerShell:

```powershell
$env:JAVA_HOME = 'C:\Users\Vlad-pc\.jdks\temurin-21.0.12.1'
$env:ANDROID_HOME = 'C:\Users\Vlad-pc\AppData\Local\Android\Sdk'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
.\gradlew.bat assembleDebug
```

Para probar las rutas del backend:

```powershell
npm --prefix backend test
```

# 🐾 Diario de salud para mascotas

App web simple para llevar el control de la medicación, el historial de salud, los documentos
y las vacunas de tus mascotas. Pensada para compartir entre varios cuidadores (familia,
pareja, etc.) con datos sincronizados en tiempo real.

Es 100% tuya: no depende de este chat ni de ningún servicio de terceros más que **Firebase**
(gratis para este uso) y **GitHub Pages** para alojarla. Vos tenés el control total de tus datos.

---

## ✨ Funcionalidades

### Hoy
- Lista del día con todas las medicaciones que corresponden, para marcarlas como dadas.
- Registro diario de síntomas/novedades, apetito, ánimo y notas libres.
- Navegación rápida por los últimos días y salto a una fecha puntual.

### Medicación
- Tres modalidades: **fija** (dosis y duración fijas), **variable** (dosis distinta día a
  día, por ejemplo un descenso progresivo) y **recurrente** (cada N días o meses).
- Las medicaciones recurrentes que no se marcan como dadas **siguen apareciendo cada día**
  (con aviso de "⚠️ atrasada") hasta que se registran — y la próxima repetición se calcula
  desde el día en que efectivamente se dio, no desde un calendario fijo.
- Foto opcional de la medicación (comprimida automáticamente), ampliable tocándola.
- Recordatorio exportable al calendario (Google Calendar / archivo .ics).

### Historial
- Todos los registros diarios guardados, ordenados por fecha.
- **Buscador de texto** sobre síntomas y notas (ignora mayúsculas y acentos, resalta las
  coincidencias, con fragmento de contexto alrededor de cada resultado).
- Los días sin ninguna novedad registrada no se muestran, para no llenar la lista de ruido.
- Salto directo a una fecha puntual.

### Documentos
- Adjuntar PDFs o fotos (análisis, recetas, estudios, etc.), con visor integrado.
- **Compartir directo al veterinario** por WhatsApp, mail o cualquier app, como adjunto real
  (no un link) — de a uno o seleccionando varios documentos juntos.

### Vacunas
- Registro de vacunas aplicadas, con foto opcional (ampliable tocándola) y aviso cuando
  se acerca o vence la fecha del próximo refuerzo.

### Para el vet
- Lista de preguntas/temas pendientes para la próxima consulta, editable con un toque en
  el lápiz (para evitar ediciones accidentales) y con casillero para marcar como resuelto.

### Varias mascotas
- Cambiá entre mascotas desde Ajustes. El nombre solo se edita tocando el lápiz ✎.
- Eliminar una mascota pide **triple confirmación** (incluyendo escribir su nombre exacto),
  ya que borra todos sus datos de forma permanente.

### Copia de seguridad
- **Descargar backup completo**: un .zip con todos los datos de todas las mascotas
  (medicaciones con fotos, historial, documentos, vacunas) organizados en carpetas, más
  un `datos.json` con toda la información en texto.
- **Restaurar backup**: subir ese mismo .zip crea mascotas nuevas con todos sus datos —
  nunca sobrescribe ni borra lo que ya tenés cargado.

### Varios cuidadores
- Invitá a otra persona (con su propia cuenta de Google) a ver y editar la misma
  información en tiempo real. Ver la sección de instalación más abajo.

---

## 🚀 Instalación (una sola vez, ~20 minutos)

### Parte 1 — Crear el proyecto de Firebase

1. Andá a **https://console.firebase.google.com** y entrá con tu cuenta de Google.
2. **Agregar proyecto** → ponele un nombre (ej. "diario-perrito") → seguir los pasos
   por defecto (podés desactivar Google Analytics, no hace falta) → **Crear proyecto**.
3. En el menú izquierdo: **Compilación → Authentication** → botón **Comenzar**.
4. Pestaña **Sign-in method** → elegí **Google** de la lista → activalo (switch arriba
   a la derecha) → elegí un email de soporte → **Guardar**.
5. En el menú izquierdo: **Compilación → Firestore Database** → **Crear base de datos**.
   - Elegí la ubicación más cercana a vos (cualquiera sirve).
   - Modo: **Producción** (no "modo de prueba").
6. Andá a la pestaña **Reglas** de Firestore y reemplazá todo el contenido por el que
   está en el archivo `firestore.rules` de esta carpeta. Tocá **Publicar**.
7. Volvé a **Configuración del proyecto** (ícono de engranaje, arriba a la izquierda)
   → pestaña **General** → bajá hasta **Tus apps** → tocá el ícono **</>** (Web).
   - Ponele un apodo (ej. "diario-web") → **Registrar app**.
   - NO hace falta Firebase Hosting, podés saltear ese paso.
   - Vas a ver un bloque `const firebaseConfig = {...}`. **Copiá esos valores**.
8. Abrí el archivo `firebase-config.js` de esta carpeta y reemplazá cada `TODO...`
   por los valores que copiaste. Guardá el archivo.

### Parte 2 — Subir la app a GitHub Pages

1. Andá a **https://github.com** → **New repository** → nombre libre (ej. `diario-perrito`)
   → público o privado (cualquiera funciona con GitHub Pages) → **Create repository**.
2. Subí estos archivos al repositorio (botón **Add file → Upload files**, arrastralos):
   - `index.html`
   - `app.js`
   - `firebase-config.js` (¡ya con tus claves pegadas!)
   - (podés subir también `firestore.rules` y este `README.md` de referencia, no molestan)
3. **Settings** del repositorio → **Pages** (menú izquierdo) →
   en "Branch" elegí `main` y carpeta `/ (root)` → **Save**.
4. Esperá 1-2 minutos y arriba te va a aparecer la URL pública, algo como:
   `https://TU-USUARIO.github.io/diario-perrito/`

### Parte 3 — Autorizar ese dominio en Firebase

1. Volvé a Firebase → **Authentication → Settings → Authorized domains**.
2. Tocá **Add domain** y pegá tu dominio de GitHub Pages, SIN el `https://` y sin la
   barra final, por ejemplo: `tu-usuario.github.io`

Sin este paso, el login con Google va a fallar con un error de dominio no autorizado.

### Parte 4 — Usarla

1. Abrí tu URL de GitHub Pages.
2. **Iniciar sesión con Google**.
3. Primera vez: tocá **Crear mi hogar** (te crea tu primera mascota, editable en Ajustes).
4. Ya podés usar las pestañas Hoy / Medicación / Historial / Documentos / Vacunas /
   Para el vet / Ajustes con todas las funciones descriptas más arriba.

### Invitar a otro cuidador (otra cuenta de Google)

1. Vos (el dueño), en **Ajustes → Compartir con otro cuidador**:
   - Copiá el **código de tu hogar**.
   - Escribí el **email de Google** de la otra persona y tocá **Autorizar este email**.
2. Envíale el código (por WhatsApp, mail, como prefieras) y la URL de la app.
3. Esa persona entra a la URL, **inicia sesión con SU propia cuenta de Google**
   (tiene que ser el email que autorizaste), pega el código en **"Ya tengo un código"**
   y toca **Unirme**.
4. A partir de ahí, ambos ven y editan exactamente la misma información.

Podés autorizar más de un email si hace falta, y quitarlos después desde el mismo
lugar (menos el tuyo, que es el dueño).

---

## 📝 Notas importantes

- **Costo**: todo esto entra cómodo en el plan gratuito ("Spark") de Firebase para
  el uso de una sola familia. No hace falta tarjeta de crédito.
- **Privacidad**: solo pueden entrar las cuentas de Google que vos autorices
  explícitamente. Nadie más puede ver los datos, ni siquiera con el link de GitHub
  Pages (sin loguearse con un email autorizado, Firestore rechaza el acceso).
- **Backups**: además de la copia de seguridad descargable desde Ajustes (recomendada,
  guarda todo en un .zip que podés restaurar cuando quieras), los datos están en
  Firestore, en tu proyecto de Firebase — tan durable como cualquier producto de
  Google Cloud.
- **Conexión a internet**: la app necesita internet para funcionar (usa Firebase para
  guardar los datos, y una librería externa —JSZip, vía CDN— para generar y restaurar
  los backups).
- **No reemplaza al veterinario**: ante cualquier síntoma preocupante, consultá
  siempre con tu veterinario.

import type { TranslationKey } from './en-US';

export const esES: Record<TranslationKey, string> = {
  'common.error.generic': 'Algo salió mal. Inténtalo de nuevo.',
  'auth.field.email': 'Correo electrónico',
  'auth.field.name': 'Nombre',
  'auth.field.password': 'Contraseña',
  'auth.field.password_confirmation': 'Confirmar contraseña',
  'auth.placeholder.email': 'Correo electrónico',
  'auth.placeholder.name': 'Nombre completo',
  'auth.placeholder.password': 'Contraseña',
  'auth.placeholder.password_confirmation': 'Confirmar contraseña',
  'auth.validation.name_required': 'El nombre es obligatorio.',
  'auth.validation.email_required': 'El correo es obligatorio.',
  'auth.validation.password_required': 'La contraseña es obligatoria.',
  'auth.validation.password_confirmation_required':
    'La confirmación de contraseña es obligatoria.',
  'auth.validation.password_policy':
    'Usa al menos 8 caracteres con mayúscula, número y símbolo ASCII (ej.: ! @ #). No se permiten emojis.',
  'auth.validation.password_confirmation_mismatch':
    'La confirmación debe coincidir con tu contraseña.',
  'auth.signin.title': 'Bienvenido de nuevo',
  'auth.signin.cta_primary': 'Iniciar sesión',
  'auth.signin.cta_create': 'Crear cuenta',
  'auth.signin.or_continue': 'o continuar con',
  'auth.signin.error.invalid_credentials':
    'El correo o la contraseña son incorrectos. Inténtalo de nuevo o restablece tu contraseña.',
  'auth.signin.error.network':
    'No se pudo conectar ahora. Comprueba tu conexión e inténtalo de nuevo.',
  'auth.signin.error.provider_conflict':
    'Este correo ya está vinculado a otro método de acceso. Inicia sesión primero con ese método.',
  'auth.signin.error.configuration':
    'La autenticación aún no está configurada. Define las claves de Firebase e inténtalo de nuevo.',
  'auth.social.google': 'Google',
  'auth.social.apple': 'Apple',
  'auth.password.toggle_show': 'Mostrar contraseña',
  'auth.password.toggle_hide': 'Ocultar contraseña',
  'auth.password.toggle_show_short': 'Mostrar',
  'auth.password.toggle_hide_short': 'Ocultar',
  'auth.signup.title': 'Crea tu cuenta',
  'auth.signup.cta_primary': 'Crear cuenta',
  'auth.signup.or_continue': 'o continuar con',
  'auth.signup.password_helper':
    'Usa al menos 8 caracteres, incluyendo mayúscula, número y símbolo (ej.: ! @ #).',
  'auth.signup.error.duplicate_email':
    'Este correo ya está en uso. Inicia sesión para continuar.',
  'auth.signup.error.network':
    'No se pudo conectar ahora. Comprueba tu conexión e inténtalo de nuevo.',
  'auth.signup.error.provider_conflict':
    'Este correo ya está vinculado a otro método de acceso. Inicia sesión primero con ese método.',
  'auth.signup.error.configuration':
    'La autenticación aún no está configurada. Define las claves de Firebase e inténtalo de nuevo.',
  'auth.signup.placeholder.body':
    'La implementación del formulario de creación de cuenta comienza en el siguiente bloque.',
  'auth.signup.cta_back_signin': 'Volver a iniciar sesión',
  'auth.role.title': '¿Cómo quieres usar la app?',
  'auth.role.intro': 'Puedes empezar por tu cuenta ahora y conectarte con un profesional después.',
  'auth.role.option_self.title': 'Quiero seguir mi propio progreso',
  'auth.role.option_self.subtitle':
    'Registra comidas y entrenamientos por tu cuenta. No necesitas un profesional.',
  'auth.role.option_pro.title': 'Soy nutricionista o entrenador físico',
  'auth.role.option_pro.subtitle':
    'Gestiona clientes, asigna planes y sigue el progreso de tus alumnos.',
  'auth.role.lock_note':
    'El tipo de cuenta no se puede cambiar después. Puedes crear otra cuenta con otro correo si lo necesitas.',
  'auth.role.cta_continue': 'Continuar',
  'auth.role.cta_back': 'Volver',
  'auth.role.cta_start_self_guided': 'Empezar por mi cuenta ahora',
  'auth.role.validation.required': 'Elige cómo quieres usar la app para continuar.',
  'auth.role.error.save_failed': 'No se pudo guardar tu perfil ahora. Inténtalo de nuevo.',
  'auth.role.placeholder.title': 'Selección de rol',
  'auth.role.placeholder.body':
    'El flujo de inicio de sesión ya está conectado. La implementación de selección de rol es el siguiente bloque.',
  'auth.role.placeholder.cta_open_app_shell': 'Abrir app',
  'student.hydration.card_title': 'Consumo de agua',
  'student.hydration.progress': '{consumed} / {goal} ml',
  'student.hydration.cta_log': 'Registrar agua',
  'student.hydration.cta_set_goal': 'Definir objetivo de agua',
  'student.hydration.goal_owner_student': 'Usando tu objetivo personal de agua',
  'student.hydration.goal_owner_nutritionist':
    'Objetivo diario de agua definido por tu nutricionista',
  'student.hydration.streak': 'Racha actual: {days} días',
  'shell.common.period': '.',
  'shell.token.path.tabs_index': 'app/(tabs)/index.tsx',
  'shell.token.path.tabs_explore': 'app/(tabs)/explore.tsx',
  'shell.token.path.tabs_layout': 'app/(tabs)/_layout.tsx',
  'shell.token.path.components_hello_wave': 'components/HelloWave.tsx',
  'shell.token.path.components_parallax_scroll_view': 'components/ParallaxScrollView.tsx',
  'shell.token.path.app': 'app',
  'shell.token.path.app_example': 'app-example',
  'shell.token.command.reset_project': 'npm run reset-project',
  'shell.token.shortcut.devtools_ios': 'cmd + d',
  'shell.token.shortcut.devtools_android': 'cmd + m',
  'shell.token.shortcut.devtools_web': 'F12',
  'shell.token.shortcut.open_web': 'w',
  'shell.token.image_suffix.2x': '@2x',
  'shell.token.image_suffix.3x': '@3x',
  'shell.token.hook.use_color_scheme': 'useColorScheme()',
  'shell.token.library.react_native_reanimated': 'react-native-reanimated',
  'shell.tabs.home': 'Inicio',
  'shell.tabs.explore': 'Explorar',
  'shell.modal.title': 'Modal',
  'shell.modal.body_title': 'Este es un modal',
  'shell.modal.link_home': 'Ir a la pantalla de inicio',
  'shell.home.title': '¡Bienvenido!',
  'shell.home.step1.title': 'Paso 1: Pruébalo',
  'shell.home.step1.part1': 'Edita',
  'shell.home.step1.part2': 'para ver los cambios. Pulsa',
  'shell.home.step1.part3': 'para abrir las herramientas de desarrollo.',
  'shell.home.step2.title': 'Paso 2: Explora',
  'shell.home.step2.description':
    'Toca la pestaña Explorar para conocer lo que incluye esta app base.',
  'shell.home.step3.title': 'Paso 3: Empieza desde cero',
  'shell.home.step3.part1': 'Cuando estés listo, ejecuta',
  'shell.home.step3.part2': 'para obtener un directorio',
  'shell.home.step3.part3': 'Esto moverá el directorio actual',
  'shell.home.step3.part4': 'a',
  'shell.home.menu.action': 'Acción',
  'shell.home.menu.share': 'Compartir',
  'shell.home.menu.more': 'Más',
  'shell.home.menu.delete': 'Eliminar',
  'shell.home.alert.action': 'Acción pulsada',
  'shell.home.alert.share': 'Compartir pulsado',
  'shell.home.alert.delete': 'Eliminar pulsado',
  'shell.explore.title': 'Explorar',
  'shell.explore.description':
    'Esta app incluye código de ejemplo para ayudarte a empezar.',
  'shell.explore.section.routing.title': 'Enrutado basado en archivos',
  'shell.explore.section.routing.line1.part1': 'Esta app tiene dos pantallas:',
  'shell.explore.section.routing.line1.part2': 'y',
  'shell.explore.section.routing.line1.part3': '.',
  'shell.explore.section.routing.line2.part1': 'El archivo de layout en',
  'shell.explore.section.routing.line2.part2': 'configura el navegador de pestañas.',
  'shell.explore.section.routing.learn_more': 'Más información',
  'shell.explore.section.platform.title': 'Soporte para Android, iOS y web',
  'shell.explore.section.platform.body.part1':
    'Puedes abrir este proyecto en Android, iOS y web. Para abrir la versión web, pulsa',
  'shell.explore.section.platform.body.part2': 'en el terminal que ejecuta este proyecto.',
  'shell.explore.section.images.title': 'Imágenes',
  'shell.explore.section.images.body.part1':
    'Para imágenes estáticas, puedes usar los sufijos',
  'shell.explore.section.images.body.part2': 'y',
  'shell.explore.section.images.body.part3':
    'para proporcionar archivos para distintas densidades de pantalla',
  'shell.explore.section.images.learn_more': 'Más información',
  'shell.explore.section.theme.title': 'Componentes para modo claro y oscuro',
  'shell.explore.section.theme.body.part1':
    'Esta plantilla tiene soporte para modo claro y oscuro. La función',
  'shell.explore.section.theme.body.part2':
    'te permite inspeccionar el esquema de color actual del usuario y ajustar los colores de la UI.',
  'shell.explore.section.theme.learn_more': 'Más información',
  'shell.explore.section.animations.title': 'Animaciones',
  'shell.explore.section.animations.body.part1':
    'Esta plantilla incluye un ejemplo de componente animado. El componente',
  'shell.explore.section.animations.body.part2': 'usa la potente librería',
  'shell.explore.section.animations.body.part3':
    'para crear una animación de una mano saludando.',
  'shell.explore.section.animations.ios_extra.part1': 'El componente',
  'shell.explore.section.animations.ios_extra.part2':
    'proporciona un efecto parallax para la imagen de cabecera.',
};

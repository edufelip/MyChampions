# V2 Localized Copy Table (Draft)

## Purpose
Provide a single translation-ready source for user-facing strings in V2 screen specs.

## Locales
- Source locale: `en-US`
- Required locales: `pt-BR`, `es-ES`

## Key Format
- Pattern: `<screen>.<section>.<element>`
- Example: `auth.role.intro`

## Translation Rules
- Keep message meaning intact: professional connection is optional for student journey.
- Prefer plain language and action-first CTAs.
- Do not introduce domain jargon when a simple alternative exists.

## String Table

| Key | Screen | Context | en-US | pt-BR | es-ES | Notes |
|---|---|---|---|---|---|---|
| `auth.role.title` | SC-201 | Role selection header | How do you want to use the app? | Como você quer usar o app? | ¿Cómo quieres usar la app? | First-time onboarding |
| `auth.role.intro` | SC-201 | Role selection helper | You can start on your own now and connect with a professional later. | Você pode começar por conta própria agora e se conectar com um profissional depois. | Puedes empezar por tu cuenta ahora y conectarte con un profesional después. | Must preserve optionality message |
| `auth.role.option_self.title` | SC-201 | Student role card | I want to track my own progress | Quero acompanhar meu próprio progresso | Quiero seguir mi propio progreso | Plain-language label |
| `auth.role.option_self.subtitle` | SC-201 | Student role card subtitle | Student account | Conta de aluno | Cuenta de alumno | Stitch compact card subtitle |
| `auth.role.option_pro.title` | SC-201 | Professional role card | I'm a nutritionist or fitness coach | Sou nutricionista ou treinador físico | Soy nutricionista o entrenador físico | Use ASCII apostrophe |
| `auth.role.option_pro.subtitle` | SC-201 | Professional role card subtitle | Professional account | Conta profissional | Cuenta profesional | Stitch compact card subtitle |
| `auth.role.lock_note` | SC-201 | Role immutability helper | Account type can't be changed later. Please choose carefully based on your needs. | O tipo de conta não pode ser alterado depois. Escolha com cuidado de acordo com suas necessidades. | El tipo de cuenta no se puede cambiar después. Elige cuidadosamente según tus necesidades. | Stitch lock-note variant; role immutability preserved |
| `auth.role.cta_continue` | SC-201 | Primary CTA | Continue | Continuar | Continuar | |
| `auth.role.cta_back` | SC-201 | Secondary CTA | Back | Voltar | Volver | |
| `auth.role.cta_start_self_guided` | SC-201 | Quick self-guided CTA | Start on my own now | Começar por conta própria agora | Empezar por mi cuenta ahora | BL-001 |
| `auth.role.validation.required` | SC-201 | Required validation message | Choose how you want to use the app to continue. | Escolha como quer usar o app para continuar. | Elige cómo quieres usar la app para continuar. | |
| `auth.role.error.save_failed` | SC-201 | Role save failure message | Could not save your role right now. Try again. | Não foi possível salvar seu perfil agora. Tente novamente. | No se pudo guardar tu perfil ahora. Inténtalo de nuevo. | Data Connect profile write failure |
| `auth.signin.title` | SC-217 | Sign-in header | Welcome | Boas-vindas | Bienvenido | |
| `auth.signin.subtitle` | SC-217 | Sign-in subtitle | Ready to crush your goals today? | Pronto para superar suas metas hoje? | ¿Listo para superar tus metas hoy? | Design-aligned supporting copy |
| `auth.signin.field.email` | SC-217 | Sign-in email label | Email Address | Endereço de e-mail | Correo electrónico | Sign-in specific label |
| `auth.signin.placeholder.email` | SC-217 | Sign-in email placeholder | hello@fitness.app | hello@fitness.app | hello@fitness.app | Design reference placeholder |
| `auth.signin.placeholder.password` | SC-217 | Sign-in password placeholder | •••••••• | •••••••• | •••••••• | Visual placeholder only |
| `auth.signin.cta_primary` | SC-217 | Primary CTA | Sign In | Entrar | Iniciar sesión | |
| `auth.signin.new_here` | SC-217 | Create-account helper | New here? | Novo por aqui? | ¿Nuevo por aquí? | Shown before create-account CTA |
| `auth.signin.cta_create` | SC-217 | Secondary CTA | Create an account | Criar uma conta | Crear una cuenta | |
| `auth.signin.or_continue` | SC-217 | Social auth divider | Or continue with | Ou continue com | O continuar con | |
| `auth.signin.error.invalid_credentials` | SC-217 | Sign-in error message | Email or password is incorrect. Try again or reset your password. | E-mail ou senha incorretos. Tente novamente ou redefina sua senha. | El correo o la contraseña son incorrectos. Inténtalo de nuevo o restablece tu contraseña. | BL-010 |
| `auth.signin.error.network` | SC-217 | Sign-in error message | Couldn't connect right now. Check your connection and try again. | Não foi possível conectar agora. Verifique sua conexão e tente novamente. | No se pudo conectar ahora. Comprueba tu conexión e inténtalo de nuevo. | BL-010 |
| `auth.signin.error.provider_conflict` | SC-217 | Sign-in provider conflict | This email is already linked to another sign-in method. Sign in with your existing method first. | Este e-mail já está vinculado a outro método de acesso. Entre primeiro com o método já vinculado. | Este correo ya está vinculado a otro método de acceso. Inicia sesión primero con ese método. | BL-010 |
| `auth.signin.error.configuration` | SC-217 | Sign-in configuration error | Authentication is not configured yet. Set Firebase keys and try again. | A autenticação ainda não está configurada. Defina as chaves do Firebase e tente novamente. | La autenticación aún no está configurada. Define las claves de Firebase e inténtalo de nuevo. | |
| `auth.signup.title` | SC-218 | Create-account header | Create your account | Crie sua conta | Crea tu cuenta | |
| `auth.field.name` | SC-218 | Name label | Name | Nome | Nombre | Shared auth field label |
| `auth.field.email` | SC-218 | Email label | Email | E-mail | Correo electrónico | Shared create-account field label |
| `auth.field.password` | SC-217/SC-218 | Password label | Password | Senha | Contraseña | Shared auth field label |
| `auth.field.password_confirmation` | SC-218 | Password confirm label | Confirm password | Confirmar senha | Confirmar contraseña | |
| `auth.placeholder.name` | SC-218 | Name placeholder | Full name | Nome completo | Nombre completo | |
| `auth.placeholder.email` | SC-218 | Email placeholder | Email | E-mail | Correo electrónico | Shared create-account placeholder |
| `auth.placeholder.password` | SC-218 | Password placeholder | Password | Senha | Contraseña | Shared create-account placeholder |
| `auth.placeholder.password_confirmation` | SC-218 | Password confirmation placeholder | Confirm password | Confirmar senha | Confirmar contraseña | |
| `auth.signup.cta_primary` | SC-218 | Primary CTA | Create account | Criar conta | Crear cuenta | |
| `auth.signup.or_continue` | SC-218 | Social auth divider | or continue with | ou continue com | o continuar con | |
| `auth.signup.password_helper` | SC-218 | Password rule helper | Use at least 8 characters, including uppercase, number, and a symbol (e.g., ! @ #). | Use pelo menos 8 caracteres, incluindo maiúscula, número e símbolo (ex.: ! @ #). | Usa al menos 8 caracteres, incluyendo mayúscula, número y símbolo (ej.: ! @ #). | |
| `auth.validation.name_required` | SC-218 | Required validation message | Name is required. | Nome é obrigatório. | El nombre es obligatorio. | |
| `auth.validation.email_required` | SC-217/SC-218 | Required validation message | Email is required. | E-mail é obrigatório. | El correo es obligatorio. | |
| `auth.validation.password_required` | SC-217/SC-218 | Required validation message | Password is required. | Senha é obrigatória. | La contraseña es obligatoria. | |
| `auth.validation.password_confirmation_required` | SC-218 | Required validation message | Password confirmation is required. | A confirmação de senha é obrigatória. | La confirmación de contraseña es obligatoria. | |
| `auth.validation.password_policy` | SC-218 | Password validation message | Use at least 8 characters with uppercase, number, and an ASCII symbol (e.g., ! @ #). Emoji are not allowed. | Use pelo menos 8 caracteres com letra maiúscula, número e símbolo ASCII (ex.: ! @ #). Emoji não é permitido. | Usa al menos 8 caracteres con mayúscula, número y símbolo ASCII (ej.: ! @ #). No se permiten emojis. | |
| `auth.validation.password_confirmation_mismatch` | SC-218 | Password mismatch message | Password confirmation must match your password. | A confirmação de senha deve ser igual à senha. | La confirmación debe coincidir con tu contraseña. | |
| `auth.signup.error.duplicate_email` | SC-218 | Duplicate email message | This email is already in use. Sign in to continue. | Este e-mail já está em uso. Entre para continuar. | Este correo ya está en uso. Inicia sesión para continuar. | BL-010 |
| `auth.signup.error.network` | SC-218 | Sign-up network error message | Couldn't connect right now. Check your connection and try again. | Não foi possível conectar agora. Verifique sua conexão e tente novamente. | No se pudo conectar ahora. Comprueba tu conexión e inténtalo de nuevo. | BL-010 |
| `auth.signup.error.provider_conflict` | SC-218 | Sign-up provider conflict | This email is already linked to another sign-in method. Sign in with your existing method first. | Este e-mail já está vinculado a outro método de acesso. Entre primeiro com o método já vinculado. | Este correo ya está vinculado a otro método de acceso. Inicia sesión primero con ese método. | BL-010 |
| `auth.signup.error.configuration` | SC-218 | Sign-up configuration error | Authentication is not configured yet. Set Firebase keys and try again. | A autenticação ainda não está configurada. Defina as chaves do Firebase e tente novamente. | La autenticación aún no está configurada. Define las claves de Firebase e inténtalo de nuevo. | |
| `auth.signup.already_have` | SC-218 | Existing-account helper | Already have an account? | Já tem uma conta? | ¿Ya tienes una cuenta? | Stitch-aligned create-account footer helper |
| `auth.signup.cta_back_signin` | SC-218 | Back-to-sign-in CTA | Back to sign in | Voltar para entrar | Volver a iniciar sesión | |
| `auth.password.toggle_show` | SC-217/SC-218 | Password visibility toggle | Show password | Mostrar senha | Mostrar contraseña | Accessibility and clarity |
| `auth.password.toggle_hide` | SC-217/SC-218 | Password visibility toggle | Hide password | Ocultar senha | Ocultar contraseña | Accessibility and clarity |
| `student.home.no_pro.title` | SC-203 | Empty-state card title | No professional connected yet | Nenhum profissional conectado ainda | Aún no hay profesional conectado | |
| `student.home.no_pro.body` | SC-203 | Empty-state card helper | You can still start tracking today on your own. | Você ainda pode começar a acompanhar hoje por conta própria. | Aún puedes empezar a hacer seguimiento hoy por tu cuenta. | Non-blocking tone |
| `student.home.cta_start_nutrition` | SC-203 | Empty-state CTA | Start my nutrition plan | Começar meu plano de nutrição | Iniciar mi plan de nutrición | |
| `student.home.cta_start_training` | SC-203 | Empty-state CTA | Start my training plan | Começar meu plano de treino | Iniciar mi plan de entrenamiento | |
| `student.home.cta_manage_professionals` | SC-203 | Action CTA | Manage professionals | Gerenciar profissionais | Gestionar profesionales | |
| `student.home.offline.stale_badge` | SC-203 | Offline stale indicator | Data may be outdated | Os dados podem estar desatualizados | Los datos pueden estar desactualizados | Show when cache is stale |
| `student.home.offline.last_sync` | SC-203 | Offline stale metadata | Last updated: {datetime} | Última atualização: {datetime} | Última actualización: {datetime} | Timestamp format localized |
| `student.home.offline.banner_read_only` | SC-203 | Offline persistent banner | You're offline. You can view cached data, but updates are locked until connection returns. | Você está offline. Você pode ver dados em cache, mas as atualizações ficam bloqueadas até a conexão voltar. | Estás sin conexión. Puedes ver los datos en caché, pero las actualizaciones están bloqueadas hasta que vuelva la conexión. | BL-008 |
| `student.home.offline.write_lock` | SC-203 | Offline blocked-write helper | Connect to the internet to save changes. | Conecte-se à internet para salvar alterações. | Conéctate a internet para guardar los cambios. | BL-008 |
| `student.home.title` | SC-203 | Dashboard title | My Dashboard | Meu Painel | Mi Panel | Stitch-aligned heading |
| `student.home.pending_connection` | SC-203 | Pending pill label | Pending Connection | Conexão Pendente | Conexión Pendiente | Stitch compact status pill |
| `student.home.hydration.title` | SC-203 | Hydration card title | Hydration | Hidratação | Hidratación | Stitch card title |
| `student.home.hydration.progress` | SC-203 | Hydration progress value | {consumed} / {goal} ml | {consumed} / {goal} ml | {consumed} / {goal} ml | |
| `student.home.hydration.goal_student` | SC-203 | Goal owner helper | Using your personal water goal | Usando seu objetivo pessoal de água | Usando tu objetivo personal de agua | |
| `student.home.hydration.goal_nutritionist` | SC-203 | Goal owner helper | Goal set by Nutritionist | Meta definida pelo nutricionista | Meta definida por el nutricionista | Stitch compact helper |
| `student.home.hydration.no_goal` | SC-203 | No-goal helper | Set a daily water goal to track progress | Defina um objetivo diário de água para acompanhar o progresso | Establece un objetivo diario de agua para seguir tu progreso | |
| `student.home.nutrition.section` | SC-203 | Nutrition card title | Nutrition Plan | Plano de Nutrição | Plan de Nutrición | Stitch active state |
| `student.home.training.section` | SC-203 | Training card title | Workout of the Day | Treino do Dia | Entrenamiento del Día | Stitch active state |
| `student.home.nutrition.plan_available` | SC-203 | Active nutrition helper | Plan available for today | Plano disponível para hoje | Plan disponible para hoy | |
| `student.home.training.plan_available` | SC-203 | Active training helper | Full body session available | Sessão de corpo inteiro disponível | Sesión de cuerpo completo disponible | |
| `student.home.no_active_plan` | SC-203 | Empty plan helper | No active plan | Nenhum plano ativo | Sin plan activo | Stitch offline/empty state |
| `student.home.cta_nutrition` | SC-203 | Active nutrition CTA | View Plan | Ver Plano | Ver Plan | Stitch active state |
| `student.home.cta_training` | SC-203 | Active training CTA | Start Training | Iniciar Treino | Iniciar Entrenamiento | Stitch active state |
| `student.home.cta_start_self` | SC-203 | Empty-state CTA | Start on my own | Começar por conta própria | Empezar por mi cuenta | Stitch offline/empty state |
| `student.home.cta_professionals` | SC-203 | Manage professionals CTA | Manage professionals | Gerenciar profissionais | Gestionar profesionales | |
| `student.home.offline.mode` | SC-203 | Offline banner title | Offline Mode | Modo Offline | Modo Sin Conexión | Stitch offline state |
| `student.home.offline.read_only_badge` | SC-203 | Hydration read-only badge | Offline: Read-only | Offline: Somente leitura | Sin conexión: Solo lectura | Stitch offline state |
| `student.home.loading.stale_title` | SC-203 | Loading stale warning title | Stale Data | Dados Desatualizados | Datos Desactualizados | Stitch loading state |
| `student.home.loading.stale_body` | SC-203 | Loading stale warning helper | Last sync > 24h ago. Pull down to refresh. | Última sincronização > 24h. Puxe para atualizar. | Última sincronización > 24h. Desliza hacia abajo para actualizar. | Stitch loading state |
| `relationship.title` | SC-211 | Screen title | Connect with professionals | Conectar com profissionais | Conectar con profesionales | Plain-language screen title |
| `relationship.intro` | SC-211 | Intro copy | Have a professional? Enter their invite code. | Tem um profissional? Insira o código de convite. | ¿Tienes un profesional? Introduce su código de invitación. | |
| `relationship.helper_self_guided` | SC-211 | Optionality helper | Don't have one yet? You can keep using the app on your own. | Ainda não tem? Você pode continuar usando o app por conta própria. | ¿Aún no tienes uno? Puedes seguir usando la app por tu cuenta. | Critical clarity copy |
| `relationship.input.invite_code` | SC-211 | Input placeholder | Enter invite code | Inserir código de convite | Introduce el código de invitación | |
| `relationship.cta_scan_qr` | SC-211 | QR scan action | Scan QR code | Escanear QR code | Escanear código QR | BL-002 |
| `relationship.qr.permission_denied` | SC-211 | Camera permission denied error | Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually. | O acesso à câmera é necessário para escanear um QR code. Conceda a permissão nas configurações do dispositivo ou insira o código manualmente. | Se necesita acceso a la cámara para escanear un código QR. Concede el permiso en los ajustes del dispositivo o introduce el código manualmente. | BL-002 |
| `relationship.qr.invalid_payload` | SC-211 | QR scan invalid payload error | This QR code doesn't contain a valid invite code. Try scanning again or enter the code manually. | Este QR code não contém um código de convite válido. Tente escanear novamente ou insira o código manualmente. | Este código QR no contiene un código de invitación válido. Intenta escanearlo de nuevo o introdúcelo manualmente. | BL-002 / TC-251 |
| `relationship.qr.close` | SC-211 | Close QR scanner modal | Close scanner | Fechar scanner | Cerrar escáner | BL-002 |
| `relationship.cta_submit_code` | SC-211 | Submit CTA | Connect | Conectar | Conectar | |
| `relationship.error.invalid_code` | SC-211 | Invite error message | This invite code is invalid. Ask your professional for a new code. | Este código de convite é inválido. Peça um novo código ao profissional. | Este código de invitación no es válido. Pide un nuevo código a tu profesional. | BL-010 |
| `relationship.error.already_connected` | SC-211 | Invite error message | You are already connected to a professional in this specialty. | Você já está conectado a um profissional nesta especialidade. | Ya estás conectado con un profesional en esta especialidad. | BL-010 |
| `relationship.error.pending_cap` | SC-211 | Invite error message | This professional has too many pending requests right now. Try again later. | Este profissional está com muitas solicitações pendentes agora. Tente novamente mais tarde. | Este profesional tiene demasiadas solicitudes pendientes ahora. Inténtalo más tarde. | BL-010 |
| `relationship.error.network` | SC-211 | Invite error message | Couldn't connect right now. Check your connection and try again. | Não foi possível conectar agora. Verifique sua conexão e tente novamente. | No se pudo conectar ahora. Comprueba tu conexión e inténtalo de nuevo. | BL-010 |
| `relationship.error.unknown` | SC-211 | Invite error message (fallback) | Something went wrong. Try again. | Algo deu errado. Tente novamente. | Algo salió mal. Inténtalo de nuevo. | BL-010 |
| `relationship.pending.helper` | SC-211 | Pending assignment state | Waiting for professional confirmation to activate this connection. | Aguardando confirmação do profissional para ativar esta conexão. | Esperando confirmación del profesional para activar esta conexión. | |
| `relationship.pending.canceled_code_rotated` | SC-211 | Pending request canceled state | This request was canceled because the professional regenerated their invite code. Ask for the new code to reconnect. | Esta solicitação foi cancelada porque o profissional regenerou o código de convite. Peça o novo código para se conectar novamente. | Esta solicitud fue cancelada porque el profesional regeneró su código de invitación. Pide el nuevo código para volver a conectarte. | |
| `pro.pending.search.placeholder` | SC-205 | Pending queue search | Search pending requests | Buscar solicitações pendentes | Buscar solicitudes pendientes | BL-004 |
| `pro.pending.filter.label` | SC-205 | Pending queue filter | Filter requests | Filtrar solicitações | Filtrar solicitudes | BL-004 |
| `pro.pending.bulk_deny.cta` | SC-205 | Bulk deny action | Deny selected | Negar selecionadas | Rechazar seleccionadas | BL-004 |
| `pro.pending.bulk_deny.confirm_title` | SC-205 | Bulk deny confirmation | Deny selected requests? | Negar solicitações selecionadas? | ¿Rechazar solicitudes seleccionadas? | BL-004 |
| `pro.pending.bulk_deny.confirm_body` | SC-205 | Bulk deny confirmation helper | Selected students can request again later with your invite code. | Alunos selecionados podem solicitar novamente depois com seu código de convite. | Los alumnos seleccionados pueden volver a solicitar más tarde con tu código de invitación. | BL-004 |
| `pro.pending.bulk_deny.success` | SC-205 | Bulk deny success feedback | Requests denied successfully. | Solicitações negadas com sucesso. | Solicitudes rechazadas correctamente. | BL-004 |
| `relationship.empty.cta_continue_self` | SC-211 | Empty-state CTA | Continue self-guided | Continuar por conta própria | Continuar por mi cuenta | |
| `relationship.unbind.cta` | SC-211 | Unbind action | End connection | Encerrar conexão | Terminar conexión | |
| `relationship.unbind.confirm_title` | SC-211 | Unbind confirmation modal | End this professional connection? | Encerrar esta conexão profissional? | ¿Terminar esta conexión profesional? | |
| `relationship.unbind.confirm_body` | SC-211 | Unbind confirmation modal | You can reconnect later with an invite code. Your history will be kept. | Você pode se reconectar depois com um código de convite. Seu histórico será mantido. | Puedes volver a conectarte más tarde con un código de invitación. Tu historial se conservará. | Reflects retention policy |
| `relationship.unbind.confirm_yes` | SC-211 | Confirmation CTA | End connection | Encerrar conexão | Terminar conexión | |
| `relationship.unbind.confirm_no` | SC-211 | Cancel CTA | Keep connection | Manter conexão | Mantener conexión | |
| `relationship.credential.registry_id` | SC-211 | Credential field label | Registry ID | Registro profissional | ID de registro | Visible only for assigned professional |
| `relationship.credential.authority` | SC-211 | Credential field label | Authority | Órgão | Organismo | Visible only for assigned professional |
| `relationship.credential.country` | SC-211 | Credential field label | Country | País | País | Visible only for assigned professional |
| `student.nutrition.title` | SC-209 | Screen title | Nutrition Today | Nutrição de Hoje | Nutrición de Hoy | |
| `student.nutrition.empty.title` | SC-209 | Tracking empty state | No active plan yet | Nenhum plano ativo ainda | Aún no hay un plan activo | |
| `student.nutrition.empty.body` | SC-209 | Tracking empty helper | You can track your own meals or wait for a professional to assign you a personalized plan. | Você pode acompanhar suas próprias refeições ou esperar um profissional atribuir um plano personalizado. | Puedes seguir tus propias comidas o esperar a que un profesional te asigne un plan personalizado. | Must preserve self-guided optionality |
| `student.nutrition.empty.cta` | SC-209 | Tracking empty CTA | Start tracking meals | Começar a acompanhar refeições | Empezar a registrar comidas | |
| `student.nutrition.water.title` | SC-209 | Hydration card title | Water intake | Ingestão de água | Ingesta de agua | BL-104 |
| `student.nutrition.water.personal_goal` | SC-209 | Goal ownership badge | Personal Goal | Meta Pessoal | Objetivo Personal | BL-104 |
| `student.nutrition.water.nutritionist_goal` | SC-209 | Goal ownership badge | Goal set by Nutritionist | Meta definida pelo Nutricionista | Objetivo definido por tu Nutricionista | BL-104 |
| `student.nutrition.water.cta_log` | SC-209 | Hydration primary action | Log Intake | Registrar Consumo | Registrar Consumo | BL-104 |
| `student.nutrition.water.cta_set_goal` | SC-209 | Hydration goal action | Set Daily Goal | Definir Meta Diária | Definir Objetivo Diario | BL-104 |
| `student.nutrition.water.log.label` | SC-209 | Hydration intake label | Amount (ml) | Quantidade (ml) | Cantidad (ml) | BL-104 |
| `student.nutrition.water.log.placeholder` | SC-209 | Hydration intake placeholder | Amount (ml) | Quantidade (ml) | Cantidad (ml) | BL-104 |
| `student.nutrition.water.goal.label` | SC-209 | Hydration goal label | Goal (ml) | Meta (ml) | Objetivo (ml) | BL-104 |
| `student.nutrition.water.goal.placeholder` | SC-209 | Hydration goal placeholder | Goal (ml) | Meta (ml) | Objetivo (ml) | BL-104 |
| `student.hydration.card_title` | SC-203/SC-209 | Hydration summary title | Water intake | Consumo de água | Consumo de agua | BL-104 |
| `student.hydration.progress` | SC-203/SC-209 | Hydration progress helper | {consumed} / {goal} ml | {consumido} / {meta} ml | {consumed} / {goal} ml | BL-104 |
| `student.hydration.cta_log` | SC-209 | Hydration primary action | Log water | Registrar água | Registrar agua | BL-104 |
| `student.hydration.cta_set_goal` | SC-209 | Hydration goal action | Set water goal | Definir meta de água | Definir objetivo de agua | BL-104 |
| `student.hydration.goal_owner_student` | SC-209 | Goal ownership helper | Using your personal water goal | Usando sua meta pessoal de água | Usando tu objetivo personal de agua | BL-104 |
| `student.hydration.goal_owner_nutritionist` | SC-209 | Goal ownership helper | Daily water goal defined by your nutritionist | Meta diária de água definida pelo seu nutricionista | Objetivo diario de agua definido por tu nutricionista | BL-104 |
| `student.hydration.streak` | SC-203/SC-209 | Streak helper | Current streak: {days} days | Sequência atual: {days} dias | Racha actual: {days} días | BL-104 |
| `student.nutrition.plan_change.cta` | SC-209 | Assigned-plan action | Request plan change | Solicitar mudança no plano | Solicitar cambio de plan | BL-005 |
| `student.nutrition.plan_change.title` | SC-209 | Change-request form title | Request a plan change | Solicitar mudança no plano | Solicitar cambio de plan | BL-005 |
| `student.nutrition.plan_change.label` | SC-209 | Change-request input label | What would you like to change? | O que você gostaria de mudar? | ¿Qué te gustaría cambiar? | BL-005 |
| `student.nutrition.plan_change.placeholder` | SC-209 | Change-request input placeholder | Describe what you would like adjusted... | Descreva o que você gostaria de ajustar... | Describe lo que te gustaría ajustar... | BL-005 |
| `student.nutrition.plan_change.validation.required` | SC-209 | Validation error | Request description is required. | A descrição da solicitação é obrigatória. | La descripción es obligatoria. | BL-005 |
| `student.nutrition.plan_change.validation.too_short` | SC-209 | Validation error | Please describe your request in more detail. | Por favor, descreva sua solicitação com mais detalhes. | Por favor, describe tu solicitud con más detalle. | BL-005 |
| `student.nutrition.plan_change.error.plan_not_found` | SC-209 | Error message | Plan not found. Pull to refresh. | Plano não encontrado. Atualize a tela. | Plan no encontrado. Actualiza la pantalla. | BL-005 |
| `student.nutrition.plan_change.error.no_active_assignment` | SC-209 | Error message | You do not have an active assigned plan. | Você não tem um plano atribuído ativo. | No tienes un plan asignado activo. | BL-005 |
| `student.nutrition.plan_change.error.network` | SC-209 | Error message | Couldn't connect. Check your connection and try again. | Sem conexão. Verifique sua conexão e tente novamente. | Sin conexión. Comprueba tu red e inténtalo de nuevo. | BL-005 |
| `student.nutrition.plan_change.error.unknown` | SC-209 | Error message | Something went wrong. Try again. | Algo deu errado. Tente novamente. | Algo salió mal. Inténtalo de nuevo. | BL-005 |
| `student.nutrition.plan_change.success` | SC-209 | Success feedback | Change request sent. | Solicitação de mudança enviada. | Solicitud de cambio enviada. | BL-005 |
| `student.nutrition.assigned_plan.read_only_notice` | SC-209 | Read-only plan notice | Your nutrition plan is professionally assigned. Contact your nutritionist to request changes. | Seu plano de nutrição foi atribuído por um profissional. Entre em contato com seu nutricionista para solicitar mudanças. | Tu plan de nutrición fue asignado por un profesional. Contacta a tu nutricionista para solicitar cambios. | BL-005, D-006 |
| `student.training.plan_change.cta` | SC-210 | Assigned-plan action | Request plan change | Solicitar mudança no plano | Solicitar cambio de plan | BL-005 |
| `student.training.plan_change.title` | SC-210 | Change-request form title | Request a plan change | Solicitar mudança no plano | Solicitar cambio de plan | BL-005 |
| `student.training.plan_change.label` | SC-210 | Change-request input label | What would you like to change? | O que você gostaria de mudar? | ¿Qué te gustaría cambiar? | BL-005 |
| `student.training.plan_change.placeholder` | SC-210 | Change-request input placeholder | Describe what you would like adjusted... | Descreva o que você gostaria de ajustar... | Describe lo que te gustaría ajustar... | BL-005 |
| `student.training.plan_change.validation.required` | SC-210 | Validation error | Request description is required. | A descrição da solicitação é obrigatória. | La descripción es obligatoria. | BL-005 |
| `student.training.plan_change.validation.too_short` | SC-210 | Validation error | Please describe your request in more detail. | Por favor, descreva sua solicitação com mais detalhes. | Por favor, describe tu solicitud con más detalle. | BL-005 |
| `student.training.plan_change.error.plan_not_found` | SC-210 | Error message | Plan not found. Pull to refresh. | Plano não encontrado. Atualize a tela. | Plan no encontrado. Actualiza la pantalla. | BL-005 |
| `student.training.plan_change.error.no_active_assignment` | SC-210 | Error message | You do not have an active assigned plan. | Você não tem um plano atribuído ativo. | No tienes un plan asignado activo. | BL-005 |
| `student.training.plan_change.error.network` | SC-210 | Error message | Couldn't connect. Check your connection and try again. | Sem conexão. Verifique sua conexão e tente novamente. | Sin conexión. Comprueba tu red e inténtalo de nuevo. | BL-005 |
| `student.training.plan_change.error.unknown` | SC-210 | Error message | Something went wrong. Try again. | Algo deu errado. Tente novamente. | Algo salió mal. Inténtalo de nuevo. | BL-005 |
| `student.training.plan_change.success` | SC-210 | Success feedback | Change request sent. | Solicitação de mudança enviada. | Solicitud de cambio enviada. | BL-005 |
| `student.training.assigned_plan.read_only_notice` | SC-210 | Read-only plan notice | Your training plan is professionally assigned. Contact your coach to request changes. | Seu plano de treino foi atribuído por um profissional. Entre em contato com seu treinador para solicitar mudanças. | Tu plan de entrenamiento fue asignado por un profesional. Contacta a tu entrenador para solicitar cambios. | BL-005, D-006 |
| `pro.student_profile.plan_change_requests.title` | SC-206 | Professional change-request section | Plan change requests | Solicitações de mudança de plano | Solicitudes de cambio de plan | BL-005 |
| `pro.student_profile.plan_change_requests.empty` | SC-206 | Empty state | No pending change requests. | Nenhuma solicitação de mudança pendente. | No hay solicitudes de cambio pendientes. | BL-005 |
| `pro.student_profile.plan_change_requests.review` | SC-206 | Triage action CTA | Mark reviewed | Marcar como revisado | Marcar como revisado | BL-005 |
| `pro.student_profile.plan_change_requests.dismiss` | SC-206 | Triage action CTA | Dismiss | Dispensar | Descartar | BL-005 |
| `pro.student_profile.plan_change_requests.load_error` | SC-206 | Load error | Could not load change requests. Try again. | Não foi possível carregar as solicitações. Tente novamente. | No se pudieron cargar las solicitudes. Inténtalo de nuevo. | BL-005 |
| `pro.student_profile.plan_change_requests.action_error` | SC-206 | Action error | Could not update request. Try again. | Não foi possível atualizar a solicitação. Tente novamente. | No se pudo actualizar la solicitud. Inténtalo de nuevo. | BL-005 |
| `pro.template_library.title` | SC-207/SC-208 | Starter template section title | Start from a template | Começar por um modelo | Empezar desde una plantilla | BL-006 |
| `pro.template_library.badge_starter` | SC-207/SC-208 | Starter template badge | Starter | Inicial | Inicial | BL-006 |
| `pro.template_library.cta_use` | SC-207/SC-208 | Starter template CTA | Use template | Usar modelo | Usar plantilla | BL-006 |
| `pro.template.clone_notice` | SC-207/SC-208 | Template helper text | We create an editable copy. The original template does not change. | Criamos uma cópia editável. O modelo original não é alterado. | Creamos una copia editable. La plantilla original no cambia. | BL-006 |
| `pro.predefined_plan.field_name` | SC-207/SC-208 | Predefined plan name label | Predefined plan name | Nome do plano predefinido | Nombre del plan predefinido | BL-106 |
| `pro.predefined_plan.cta_create` | SC-207/SC-208 | Create predefined plan CTA | Save predefined plan | Salvar plano predefinido | Guardar plan predefinido | BL-106 |
| `pro.predefined_plan.bulk_assign.cta` | SC-205/SC-207/SC-208 | Bulk assign entry CTA | Bulk assign plan | Atribuir plano em massa | Asignar plan en masa | BL-106 |
| `pro.predefined_plan.bulk_assign.title` | SC-205/SC-207/SC-208 | Bulk assign modal title | Assign this plan to multiple students | Atribuir este plano para vários alunos | Asignar este plan a varios alumnos | BL-106 |
| `pro.predefined_plan.bulk_assign.select_students` | SC-205 | Bulk assign helper | Select students to receive this plan | Selecione os alunos que vão receber este plano | Selecciona los alumnos que recibirán este plan | BL-106 |
| `pro.predefined_plan.bulk_assign.fine_tune_title` | SC-207/SC-208 | Fine-tune step title | Fine-tune each student plan | Ajustar o plano de cada aluno | Ajustar el plan de cada alumno | BL-106 |
| `pro.predefined_plan.bulk_assign.cta_finalize` | SC-207/SC-208 | Final bulk assign CTA | Confirm assignments | Confirmar atribuições | Confirmar asignaciones | BL-106 |
| `pro.predefined_plan.copy_independent_note` | SC-207/SC-208 | Copy isolation helper | Each student gets an independent copy. Future library edits won't change assigned plans. | Cada aluno recebe uma cópia independente. Alterações futuras na biblioteca não mudam planos já atribuídos. | Cada alumno recibe una copia independiente. Los cambios futuros en la biblioteca no afectarán los planes ya asignados. | BL-106 |
| `pro.student.water_goal.section_title` | SC-206 | Professional water goal section title | Student water goal | Meta de água do aluno | Objetivo de agua del alumno | BL-104 |
| `pro.student.water_goal.field_daily_ml` | SC-206 | Professional water goal input label | Daily water goal (ml) | Meta diária de água (ml) | Objetivo diario de agua (ml) | BL-104 |
| `pro.student.water_goal.cta_save` | SC-206 | Professional water goal save CTA | Save water goal | Salvar meta de água | Establecer objetivo de agua | BL-104 |
| `custom_meal.builder.title` | SC-214 | Builder screen title | Create custom meal | Criar refeição personalizada | Crear comida personalizada | |
| `custom_meal.builder.helper` | SC-214 | Builder helper text | Add total meal weight and nutrients. We use this to calculate any portion you log. | Adicione o peso total da refeição e os nutrientes. Usamos isso para calcular qualquer porção que você registrar. | Añade el peso total de la comida y los nutrientes. Los usamos para calcular cualquier porción que registres. | |
| `custom_meal.field.name` | SC-214 | Field label | Meal name | Nome da refeição | Nombre de la comida | |
| `custom_meal.field.total_grams` | SC-214 | Field label | Total meal weight (g) | Peso total da refeição (g) | Peso total de la comida (g) | |
| `custom_meal.field.calories` | SC-214 | Field label | Total calories | Calorias totais | Calorías totales | |
| `custom_meal.field.carbs` | SC-214 | Field label | Carbs (g) | Carboidratos (g) | Carbohidratos (g) | |
| `custom_meal.field.proteins` | SC-214 | Field label | Proteins (g) | Proteínas (g) | Proteínas (g) | |
| `custom_meal.field.fats` | SC-214 | Field label | Fats (g) | Gorduras (g) | Grasas (g) | |
| `custom_meal.field.cost_optional` | SC-214 | Field label | Ingredient cost (optional) | Custo dos ingredientes (opcional) | Costo de los ingredientes (opcional) | |
| `custom_meal.field.image_optional` | SC-214 | Field label | Recipe image (optional) | Imagem da receita (opcional) | Imagen de la receta (opcional) | BL-007 |
| `custom_meal.image.upload_progress` | SC-214 | Upload progress helper | Uploading image... {progress}% | Enviando imagem... {progress}% | Subiendo imagen... {progress}% | BL-007 |
| `custom_meal.image.upload_failed` | SC-214 | Upload failure helper | We couldn't upload the image. Check your connection and try again. | Não foi possível enviar a imagem. Verifique sua conexão e tente novamente. | No se pudo subir la imagen. Comprueba tu conexión e inténtalo de nuevo. | BL-007 |
| `custom_meal.image.retry` | SC-214 | Upload retry CTA | Retry upload | Tentar envio novamente | Reintentar subida | BL-007 |
| `custom_meal.image.file_too_large` | SC-214 | Upload error — file size | The image is too large. Please choose a smaller file. | A imagem é muito grande. Por favor, escolha um arquivo menor. | La imagen es demasiado grande. Por favor, elige un archivo más pequeño. | BL-007 |
| `custom_meal.image.unauthorized` | SC-214 | Upload error — auth | Upload failed. Please sign out and sign in again. | Falha no envio. Por favor, saia e entre novamente. | Error al subir. Por favor, cierra sesión y vuelve a iniciarla. | BL-007 |
| `custom_meal.builder.cta_save` | SC-214 | Save action | Save meal | Salvar refeição | Guardar comida | |
| `custom_meal.builder.validation.grams_positive` | SC-214 | Validation message | Total grams must be greater than zero. | O total em gramas deve ser maior que zero. | El total en gramos debe ser mayor que cero. | |
| `custom_meal.library.empty.title` | SC-215 | Empty-state title | No custom meals yet | Ainda não há refeições personalizadas | Aún no hay comidas personalizadas | |
| `custom_meal.library.empty.helper` | SC-215 | Empty-state helper | Create your first custom meal to log portions in seconds. | Crie sua primeira refeição personalizada para registrar porções em segundos. | Crea tu primera comida personalizada para registrar porciones en segundos. | |
| `custom_meal.library.cta_create` | SC-215 | Empty-state CTA | Create custom meal | Criar refeição personalizada | Crear comida personalizada | |
| `custom_meal.quicklog.helper` | SC-215 | Portion log helper | Enter grams consumed. We calculate calories and macros automatically. | Insira os gramas consumidos. Calculamos calorias e macronutrientes automaticamente. | Introduce los gramos consumidos. Calculamos las calorías y macros automáticamente. | |
| `custom_meal.quicklog.field.grams` | SC-215 | Field label | Grams consumed | Gramas consumidos | Gramos consumidos | |
| `custom_meal.quicklog.preview_title` | SC-215 | Calculation preview | Estimated nutrients for this portion | Nutrientes estimados para esta porção | Nutrientes estimados para esta porción | |
| `custom_meal.quicklog.cta_log` | SC-215 | Log action | Log meal | Registrar refeição | Registrar comida | |
| `custom_meal.share.cta` | SC-214/SC-215 | Share action | Share recipe | Compartilhar receita | Compartir receta | |
| `custom_meal.share.link_copied` | SC-214/SC-215 | Share success feedback | Recipe link copied | Link da receita copiado | Enlace de la receta copiado | |
| `shared_recipe.confirm.title` | SC-216 | Confirmation header | Save shared recipe | Salvar receita compartilhada | Guardar receta compartida | |
| `shared_recipe.confirm.helper` | SC-216 | Confirmation helper | Save this recipe to your account to use it in your daily tracking. | Salve esta receita na sua conta para usá-la no seu acompanhamento diário. | Guarda esta receta en tu cuenta para usarla en tu seguimiento diario. | |
| `shared_recipe.confirm.ownership_note` | SC-216 | Ownership disclosure | After saving, this copy is yours even if the original creator deletes theirs. | Depois de salvar, esta cópia é sua mesmo que o criador original exclua a dele. | Al guardar, esta copia es tuya aunque el creador original borre la suya. | |
| `shared_recipe.confirm.cta_save` | SC-216 | Primary action | Save to my account | Salvar na minha conta | Guardar en mi cuenta | |
| `shared_recipe.confirm.cta_cancel` | SC-216 | Secondary action | Not now | Agora não | Ahora no | |
| `shared_recipe.error.invalid_link` | SC-216 | Invalid token state | This shared recipe link is invalid. | Este link de receita compartilhada é inválido. | Este enlace de receta compartida no es válido. | |
| `shared_recipe.success.saved` | SC-216 | Save success feedback | Recipe saved to your account | Receita salva na sua conta | Receta guardada en tu cuenta | |
| `shared_recipe.auth.required` | SC-216 | Login-required helper | Sign in to save this recipe. We'll bring you back here right after login. | Entre para salvar esta receita. Vamos trazer você de volta para cá logo após o login. | Inicia sesión para guardar esta receta. Te traeremos de vuelta aquí justo después del login. | |
| `shared_recipe.info.already_saved` | SC-216 | Idempotent import helper | You already saved this recipe in your account. | Você já salvou esta receita na sua conta. | Ya guardaste esta receta en tu cuenta. | |
| `student.training.title` | SC-210 | Screen title | Today | Hoje | Hoy | |
| `student.training.calendar.cta` | SC-210 | Calendar action | Open calendar | Abrir calendário | Abrir calendario | |
| `student.training.session.title` | SC-210 | Assigned-plan summary title | Today's guided plan | Plano guiado de hoje | Plan guiado de hoy | |
| `student.training.session.body` | SC-210 | Assigned-plan summary helper | Your coach assigned a training structure. Track completion and request adjustments below. | Seu treinador atribuiu uma estrutura de treino. Registre sua execução e solicite ajustes abaixo. | Tu entrenador asignó una estructura de entrenamiento. Registra tu ejecución y solicita ajustes abajo. | |
| `student.training.empty.title` | SC-210 | Tracking empty state | Start your own journey | Comece sua própria jornada | Empieza tu propio camino | |
| `student.training.empty.body` | SC-210 | Tracking empty helper | You don't have a coach yet, but you can track your own workouts and stay active! | Você ainda não tem treinador, mas pode registrar seus próprios treinos e manter-se ativo! | Aún no tienes entrenador, pero puedes registrar tus propios entrenamientos y mantenerte activo. | Must preserve self-guided optionality |
| `student.training.empty.cta` | SC-210 | Tracking empty CTA | Create a workout | Criar treino | Crear entrenamiento | |
| `pro.subscription.limit_title` | SC-212 | Cap gate title | Unlock more than 10 active students | Desbloqueie mais de 10 alunos ativos | Desbloquea más de 10 alumnos activos | Professional-only monetization |
| `pro.subscription.limit_body` | SC-212 | Cap gate helper | Upgrade your professional plan to manage more than 10 active students. | Faça upgrade do seu plano profissional para gerenciar mais de 10 alunos ativos. | Actualiza tu plan profesional para gestionar más de 10 alumnos activos. | |
| `pro.subscription.cta_subscribe` | SC-212 | Purchase CTA | Upgrade now | Fazer upgrade agora | Actualizar ahora | |
| `pro.subscription.cta_restore` | SC-212 | Restore CTA | Restore purchase | Restaurar compra | Restaurar compra | |
| `pro.subscription.status_active` | SC-212 | Entitlement badge | Subscription active | Assinatura ativa | Suscripción activa | |
| `pro.subscription.pre_lapse.title` | SC-212 | Pre-lapse warning title | Your subscription is close to expiring | Sua assinatura está perto de expirar | Tu suscripción está a punto de expirar | BL-009 |
| `pro.subscription.pre_lapse.body` | SC-212 | Pre-lapse warning helper | Renew now to avoid student management locks. | Renove agora para evitar bloqueios no gerenciamento de alunos. | Renueva ahora para evitar bloqueos en la gestión de alumnos. | BL-009 |
| `pro.subscription.pre_lapse.cta_renew` | SC-212 | Pre-lapse warning CTA | Renew subscription | Renovar assinatura | Renovar suscripción | BL-009 |
| `pro.specialty.remove_blocked.title` | SC-202 | Specialty blocked-state title | You can't remove this specialty yet | Você ainda não pode remover esta especialidade | Aún no puedes eliminar esta especialidad | BL-011 |
| `pro.specialty.remove_blocked.body` | SC-202 | Specialty blocked-state helper | Resolve active or pending student links for this specialty first. | Resolva primeiro os vínculos de alunos ativos ou pendentes desta especialidade. | Primero resuelve los vínculos de alumnos activos o pendientes de esta especialidad. | BL-011 |
| `pro.specialty.remove_blocked.cta_view_active` | SC-202 | Blocked-state CTA | View active students | Ver alunos ativos | Ver alumnos activos | BL-011 |
| `pro.specialty.remove_blocked.cta_manage_pending` | SC-202 | Blocked-state CTA | Manage pending requests | Gerenciar solicitações pendentes | Gestionar solicitudes pendientes | BL-011 |
| `pro.specialty.remove_blocked.dismiss` | SC-202 | Blocked-state dismiss CTA | Dismiss | Dispensar | Descartar | BL-011 D-124 |
| `pro.specialty.removal_blocked.title` | SC-202 | Assist card title | Cannot remove specialty | Não é possível remover a especialidade | No se puede eliminar la especialidad | BL-011 D-124 |
| `pro.specialty.removal_blocked.active_students_body` | SC-202 | Assist card body (active) | This specialty has {count} active student{plural}. Unbind or complete active assignments first. | Esta especialidade tem {count} aluno{plural} ativo. Desvincule ou conclua as atribuições ativas primeiro. | Esta especialidad tiene {count} alumno{plural} activo. Desvincule o complete las asignaciones activas primero. | BL-011 D-124 |
| `pro.specialty.removal_blocked.pending_students_body` | SC-202 | Assist card body (pending) | This specialty has {count} pending student{plural}. Accept or deny pending requests first. | Esta especialidade tem {count} aluno{plural} pendente. Aceite ou negue as solicitações pendentes primeiro. | Esta especialidad tiene {count} alumno{plural} pendiente. Acepte o rechace las solicitudes pendientes primero. | BL-011 D-124 |
| `pro.specialty.removal_blocked.last_specialty_body` | SC-202 | Assist card body (last specialty) | You must have at least one specialty. Add a new specialty before removing this one. | Você deve ter pelo menos uma especialidade. Adicione uma nova especialidade antes de remover esta. | Debe tener al menos una especialidad. Añada una nueva especialidad antes de eliminar esta. | BL-011 D-124 |
| `pro.specialty.removal_assist.view_active` | SC-202 | Assist action label | View active students | Ver alunos ativos | Ver alumnos activos | BL-011 D-124 |
| `pro.specialty.removal_assist.view_active_desc` | SC-202 | Assist action description | See and manage active student assignments | Ver e gerenciar atribuições de alunos ativos | Ver y gestionar asignaciones de alumnos activos | BL-011 D-124 |
| `pro.specialty.removal_assist.view_pending` | SC-202 | Assist action label | View pending requests | Ver solicitações pendentes | Ver solicitudes pendientes | BL-011 D-124 |
| `pro.specialty.removal_assist.view_pending_desc` | SC-202 | Assist action description | Review pending connection requests | Revisar solicitações de conexão pendentes | Revisar solicitudes de conexión pendientes | BL-011 D-124 |
| `pro.specialty.removal_assist.bulk_deny` | SC-202 | Assist action label | Deny pending requests | Negar solicitações pendentes | Rechazar solicitudes pendientes | BL-011 D-124 |
| `pro.specialty.removal_assist.bulk_deny_desc` | SC-202 | Assist action description | Bulk deny pending requests to clear blockers | Negar em massa solicitações pendentes para liberar bloqueios | Rechace en masa las solicitudes pendientes para limpiar bloqueos | BL-011 D-124 |
| `pro.specialty.removal_assist.add_specialty` | SC-202 | Assist action label | Add another specialty | Adicionar outra especialidade | Añadir otra especialidad | BL-011 D-124 |
| `pro.specialty.removal_assist.add_specialty_desc` | SC-202 | Assist action description | Add Nutritionist or Fitness Coach to enable removal | Adicione Nutricionista ou Personal Trainer para permitir remoção | Añada Nutricionista o Entrenador Personal para permitir la eliminación | BL-011 D-124 |
| `settings.account.title` | SC-213 | Settings header | Account and privacy | Conta e privacidade | Cuenta y privacidad | |
| `settings.account.cta_privacy_policy` | SC-213 | Legal link CTA | View privacy policy | Ver política de privacidade | Ver política de privacidad | |
| `settings.account.cta_delete_account` | SC-213 | Deletion CTA | Delete account | Excluir conta | Eliminar cuenta | Store compliance critical |
| `settings.account.delete.confirm_title` | SC-213 | Deletion confirmation | Delete your account? | Excluir sua conta? | ¿Eliminar tu cuenta? | |
| `settings.account.delete.confirm_body` | SC-213 | Deletion warning | This starts your account deletion request. Some data may be retained when legally required. | Isso inicia sua solicitação de exclusão de conta. Alguns dados podem ser retidos quando exigidos por lei. | Esto inicia tu solicitud de eliminación de cuenta. Algunos datos pueden conservarse cuando lo exija la ley. | Compliance-sensitive text |
| `settings.account.delete.confirm_yes` | SC-213 | Confirm deletion CTA | Request deletion | Solicitar exclusão | Solicitar eliminación | |
| `settings.account.delete.confirm_no` | SC-213 | Cancel CTA | Cancel | Cancelar | Cancelar | |
| `common.error.retry` | Common | Generic error action | Try again | Tentar novamente | Intentar de nuevo | Shared utility string |
| `common.loading.default` | Common | Generic loading text | Loading... | Carregando... | Cargando... | Shared utility string |
| `common.empty.no_data` | Common | Generic empty text | Nothing here yet. | Ainda não há nada aqui. | Aún no hay nada aquí. | Use only when screen-specific copy is unavailable |

| `a11y.loading.default` | Global | SR loading label | Loading… | Carregando… | Cargando… | |
| `a11y.loading.submitting` | Global | SR submit loading label | Submitting… | Enviando… | Enviando… | |
| `a11y.loading.saving` | Global | SR save loading label | Saving… | Salvando… | Guardando… | |
| `a11y.loading.invite_code` | SC-204 | SR invite code loading | Loading invite code… | Carregando código de convite… | Cargando código de invitación… | |
| `a11y.selected_count` | SC-pending | SR bulk selection count | {count} selected | {count} selecionado(s) | {count} seleccionado(s) | Replaces hardcoded string in pending.tsx |
| `a11y.student_row` | SC-205 | SR student row label | {name}, {specialty}, {status} | {name}, {specialty}, {status} | {name}, {specialty}, {status} | Combines name+specialty+status for SR |
| `a11y.stat_card` | SC-204 | SR stat card label | {value} {label} | {value} {label} | {value} {label} | Combines value+label for stat cards |
| `meal.photo_analysis.cta` | SC-214/SC-215 | Camera/AI entry CTA | Analyze with AI | Analisar com IA | Analizar con IA | BL-108 |
| `meal.photo_analysis.analyzing` | SC-219 | In-progress loading text | Analyzing your meal… | Analisando sua refeição… | Analizando tu comida… | BL-108 |
| `meal.photo_analysis.disclaimer` | SC-219 | Estimate disclaimer | These are AI estimates. Please verify before saving. | Estes são valores estimados pela IA. Verifique antes de salvar. | Estos son valores estimados por IA. Verifícalos antes de guardar. | BR-290; always shown with results |
| `meal.photo_analysis.error.unrecognizable` | SC-219 | Unrecognizable image error | Couldn't identify a meal in this photo. Try again or fill in manually. | Não foi possível identificar uma refeição nesta foto. Tente novamente ou preencha manualmente. | No se pudo identificar una comida en esta foto. Inténtalo de nuevo o rellena manualmente. | BL-108 |
| `meal.photo_analysis.error.quota` | SC-219 | Quota exceeded error | AI analysis is temporarily unavailable. Please fill in manually. | A análise por IA está temporariamente indisponível. Por favor, preencha manualmente. | El análisis de IA no está disponible temporalmente. Por favor, rellena manualmente. | BL-108 |
| `meal.photo_analysis.error.network` | SC-219 | Network error | Network error during analysis. Check your connection and try again. | Erro de rede durante a análise. Verifique sua conexão e tente novamente. | Error de red durante el análisis. Comprueba tu conexión e inténtalo de nuevo. | BL-108 |
| `meal.photo_analysis.error.generic` | SC-219 | Generic fallback error | Analysis failed. You can still fill in the fields manually. | A análise falhou. Você ainda pode preencher os campos manualmente. | El análisis falló. Aún puedes rellenar los campos manualmente. | BL-108 |
| `meal.photo_analysis.attach_photo.label` | SC-214 | Optional photo attachment toggle | Also attach this photo to the meal | Também anexar esta foto à refeição | También adjuntar esta foto a la comida | SC-214 only; post-analysis optional step |
| `meal.photo_analysis.confidence.low` | SC-219 | Low-confidence warning | Low confidence — double-check these estimates | Baixa confiança — confira esses valores | Baja confianza — revisa estos valores | Shown when confidence='low' |
| `meal.photo_analysis.paywall.locked` | SC-214/SC-215 | Paywall locked label | AI analysis is a premium feature | Análise com IA é um recurso premium | El análisis con IA es una función premium | D-132; shown when hasAiAccess=false |
| `meal.photo_analysis.paywall.cta_upgrade` | SC-214/SC-215 | Paywall upgrade CTA | Upgrade to unlock | Fazer upgrade para desbloquear | Actualizar para desbloquear | Opens RevenueCat native paywall; D-132 |
| `meal.photo_analysis.paywall.loading` | SC-214/SC-215 | Subscription loading state | Checking subscription… | Verificando assinatura… | Verificando suscripción… | Shown while isSubscriptionLoading=true; D-132 |

| `pro.library.nutrition.title` | SC-207 lib | Tab screen header | Nutrition Plans | Planos de Nutrição | Planes de Nutrición | |
| `pro.library.nutrition.empty` | SC-207 lib | Empty state body | No nutrition plans yet. Create your first plan. | Nenhum plano de nutrição ainda. Crie seu primeiro plano. | Aún no hay planes de nutrición. Crea tu primer plan. | |
| `pro.library.nutrition.cta_create` | SC-207 lib | Create CTA | Create nutrition plan | Criar plano de nutrição | Crear plan de nutrición | |
| `pro.library.training.title` | SC-208 lib | Tab screen header | Training Plans | Planos de Treino | Planes de Entrenamiento | |
| `pro.library.training.empty` | SC-208 lib | Empty state body | No training plans yet. Create your first plan. | Nenhum plano de treino ainda. Crie seu primeiro plano. | Aún no hay planes de entrenamiento. Crea tu primer plan. | |
| `pro.library.training.cta_create` | SC-208 lib | Create CTA | Create training plan | Criar plano de treino | Crear plan de entrenamiento | |
| `pro.library.cta_open` | SC-207/208 lib | Open plan CTA | Open | Abrir | Abrir | |
| `pro.library.error` | SC-207/208 lib | Load error | Could not load plans. Try again. | Não foi possível carregar os planos. Tente novamente. | No se pudieron cargar los planes. Inténtalo de nuevo. | |
| `pro.plan.nutrition.title.create` | SC-207 | Screen title (create) | Create nutrition plan | Criar plano de nutrição | Crear plan de nutrición | |
| `pro.plan.nutrition.title.edit` | SC-207 | Screen title (edit) | Edit nutrition plan | Editar plano de nutrição | Editar plan de nutrición | |
| `pro.plan.training.title.create` | SC-208 | Screen title (create) | Create training plan | Criar plano de treino | Crear plan de entrenamiento | |
| `pro.plan.training.title.edit` | SC-208 | Screen title (edit) | Edit training plan | Editar plano de treino | Editar plan de entrenamiento | |
| `pro.plan.field.name.label` | SC-207/208 | Plan name label | Plan name | Nome do plano | Nombre del plan | BR-281, BR-291, BR-293 |
| `pro.plan.field.name.placeholder` | SC-207/208 | Plan name placeholder | e.g. Caloric Deficit A | ex.: Déficit Calórico A | p.ej. Déficit Calórico A | |
| `pro.plan.field.calories_target.label` | SC-207 | Calorie target label | Calorie target (kcal) | Meta de calorias (kcal) | Meta de calorías (kcal) | BR-210 |
| `pro.plan.field.calories_target.placeholder` | SC-207 | Calorie placeholder | e.g. 2000 | ex.: 2000 | p.ej. 2000 | |
| `pro.plan.field.carbs_target.label` | SC-207 | Carbs target label | Carbs target (g) | Meta de carboidratos (g) | Meta de carbohidratos (g) | BR-210 |
| `pro.plan.field.proteins_target.label` | SC-207 | Proteins target label | Proteins target (g) | Meta de proteínas (g) | Meta de proteínas (g) | BR-210 |
| `pro.plan.field.fats_target.label` | SC-207 | Fats target label | Fats target (g) | Meta de gorduras (g) | Meta de grasas (g) | BR-210 |
| `pro.plan.section.meals` | SC-207 | Section header | Meals | Refeições | Comidas | |
| `pro.plan.section.sessions` | SC-208 | Section header | Sessions | Sessões | Sesiones | |
| `pro.plan.cta.add_meal` | SC-207 | Add item CTA | Add food item | Adicionar alimento | Añadir alimento | |
| `pro.plan.cta.add_session` | SC-208 | Add session CTA | Add session | Adicionar sessão | Añadir sesión | |
| `pro.plan.cta.add_item` | SC-208 | Add session item CTA | Add item | Adicionar item | Añadir ítem | |
| `pro.plan.cta.save` | SC-207/208 | Save CTA | Save plan | Salvar plano | Guardar plan | |
| `pro.plan.cta.assign` | SC-207/208 | Assign CTA | Assign to student | Atribuir ao aluno | Asignar al alumno | |
| `pro.plan.cta.bulk_assign` | SC-207/208 | Bulk assign CTA | Bulk assign | Atribuição em massa | Asignación masiva | D-082 |
| `pro.plan.cta.clone_template` | SC-207/208 | Template clone CTA | Start from template | Começar com modelo | Empezar desde plantilla | FR-247 |
| `pro.plan.template.starter_label` | SC-207/208 | Template section label | Starter templates | Modelos iniciais | Plantillas iniciales | |
| `pro.plan.template.picker_title` | SC-207/208 | Template picker title | Choose a starter template | Escolha um modelo inicial | Elige una plantilla inicial | |
| `pro.plan.template.cta_use` | SC-207/208 | Use template CTA | Use this template | Usar este modelo | Usar esta plantilla | |
| `pro.plan.food_search.placeholder` | SC-207 | Food search input | Search foods… | Buscar alimentos… | Buscar alimentos… | FR-243; fatsecret deferred |
| `pro.plan.food_search.empty` | SC-207 | Empty food search | No foods found. Try a different search term. | Nenhum alimento encontrado. Tente outro termo. | No se encontraron alimentos. Prueba otro término. | |
| `pro.plan.food_search.stub_notice` | SC-207 | Stub notice | Food search will be available in a future update. | A busca de alimentos estará disponível em uma atualização futura. | La búsqueda de alimentos estará disponible en una próxima actualización. | D-113 |
| `pro.plan.validation.name_required` | SC-207/208 | Name required error | Plan name is required. | O nome do plano é obrigatório. | El nombre del plan es obligatorio. | BR-291, BR-293 |
| `pro.plan.validation.name_too_short` | SC-207/208 | Name too short error | Plan name must be at least 2 characters. | O nome do plano deve ter pelo menos 2 caracteres. | El nombre del plan debe tener al menos 2 caracteres. | |
| `pro.plan.validation.calories_non_negative` | SC-207 | Negative calories error | Calorie target must be zero or more. | A meta de calorias deve ser zero ou mais. | La meta de calorías debe ser cero o más. | BR-292 |
| `pro.plan.validation.macros_non_negative` | SC-207 | Negative macros error | Macro targets must be zero or more. | As metas de macronutrientes devem ser zero ou mais. | Las metas de macronutrientes deben ser cero o más. | BR-292 |
| `pro.plan.error.save` | SC-207/208 | Save error | Could not save plan. Try again. | Não foi possível salvar o plano. Tente novamente. | No se pudo guardar el plan. Inténtalo de nuevo. | |
| `pro.plan.error.load` | SC-207/208 | Load error | Could not load plan. Try again. | Não foi possível carregar o plano. Tente novamente. | No se pudo cargar el plan. Inténtalo de nuevo. | |
| `pro.plan.error.assign` | SC-207/208 | Assign error | Could not assign plan. Try again. | Não foi possível atribuir o plano. Tente novamente. | No se pudo asignar el plan. Inténtalo de nuevo. | |
| `pro.plan.assign.title` | SC-207/208 | Assign modal title | Assign plan | Atribuir plano | Asignar plan | |
| `pro.plan.assign.student_count` | SC-207/208 | Student count label | {count} student(s) selected | {count} aluno(s) selecionado(s) | {count} alumno(s) seleccionado(s) | |
| `pro.plan.assign.confirm` | SC-207/208 | Confirm assign CTA | Confirm assignment | Confirmar atribuição | Confirmar asignación | |
| `pro.plan.assign.fine_tune_notice` | SC-207/208 | Fine-tune notice | Each student receives an independent copy you can fine-tune before confirming. | Cada aluno recebe uma cópia independente que você pode ajustar antes de confirmar. | Cada alumno recibe una copia independiente que puedes ajustar antes de confirmar. | BR-283 |
| `pro.plan.session.field.name.label` | SC-208 | Session name label | Session name | Nome da sessão | Nombre de la sesión | |
| `pro.plan.session.field.name.placeholder` | SC-208 | Session name placeholder | e.g. Day A — Upper Body | ex.: Dia A — Superior | p.ej. Día A — Tren superior | |
| `pro.plan.session.field.notes.label` | SC-208 | Session notes label | Session notes (optional) | Notas da sessão (opcional) | Notas de la sesión (opcional) | |
| `pro.plan.item.field.name.label` | SC-208 | Item name label | Exercise / item name | Nome do exercício / item | Nombre del ejercicio / ítem | BR-294 |
| `pro.plan.item.field.name.placeholder` | SC-208 | Item name placeholder | e.g. Bench Press | ex.: Supino reto | p.ej. Press de banca | |
| `pro.plan.item.field.quantity.label` | SC-208 | Item quantity label | Quantity (optional) | Quantidade (opcional) | Cantidad (opcional) | |
| `pro.plan.item.field.quantity.placeholder` | SC-208 | Item quantity placeholder | e.g. 3 sets × 10 reps | ex.: 3 séries × 10 reps | p.ej. 3 series × 10 reps | |
| `pro.plan.item.field.notes.label` | SC-208 | Item notes label | Notes (optional) | Observações (opcional) | Notas (opcional) | |
| `pro.plan.predefined.label` | SC-207/208 | Plan kind badge | Predefined plan | Plano predefinido | Plan predefinido | BR-281 |

## Notes
- All es-ES translations have been filled. Review with a native Spanish speaker before release.
- Keep this file aligned with screen specs and implementation keys.

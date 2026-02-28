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
| `auth.role.title` | SC-201 | Role selection header | How do you want to use the app? | Como você quer usar o app? | TODO | First-time onboarding |
| `auth.role.intro` | SC-201 | Role selection helper | You can start on your own now and connect with a professional later. | Você pode começar por conta própria agora e se conectar com um profissional depois. | TODO | Must preserve optionality message |
| `auth.role.option_self.title` | SC-201 | Student role card | I want to track my own progress | Quero acompanhar meu próprio progresso | TODO | Plain-language label |
| `auth.role.option_self.subtitle` | SC-201 | Student role card subtitle | Log meals and workouts by yourself. No professional required. | Registre refeições e treinos por conta própria. Nenhum profissional é necessário. | TODO | Critical clarity copy |
| `auth.role.option_pro.title` | SC-201 | Professional role card | I'm a nutritionist or fitness coach | Sou nutricionista ou treinador físico | TODO | Use ASCII apostrophe |
| `auth.role.option_pro.subtitle` | SC-201 | Professional role card subtitle | Manage clients, assign plans, and track student progress. | Gerencie clientes, atribua planos e acompanhe o progresso dos alunos. | TODO | |
| `auth.role.lock_note` | SC-201 | Role immutability helper | Account type can't be changed later. You can create another account with a different email if needed. | O tipo de conta não pode ser alterado depois. Você pode criar outra conta com outro e-mail, se precisar. | TODO | Role immutability disclosure |
| `auth.role.cta_continue` | SC-201 | Primary CTA | Continue | Continuar | TODO | |
| `auth.role.cta_back` | SC-201 | Secondary CTA | Back | Voltar | TODO | |
| `auth.role.cta_start_self_guided` | SC-201 | Quick self-guided CTA | Start on my own now | Começar por conta própria agora | TODO | BL-001 |
| `auth.signin.title` | SC-217 | Sign-in header | Welcome back | Que bom ter você de volta | TODO | |
| `auth.signin.cta_primary` | SC-217 | Primary CTA | Sign in | Entrar | TODO | |
| `auth.signin.cta_create` | SC-217 | Secondary CTA | Create account | Criar conta | TODO | |
| `auth.signin.or_continue` | SC-217 | Social auth divider | or continue with | ou continue com | TODO | |
| `auth.signin.error.invalid_credentials` | SC-217 | Sign-in error message | Email or password is incorrect. Try again or reset your password. | E-mail ou senha incorretos. Tente novamente ou redefina sua senha. | TODO | BL-010 |
| `auth.signin.error.network` | SC-217 | Sign-in error message | Couldn't connect right now. Check your connection and try again. | Não foi possível conectar agora. Verifique sua conexão e tente novamente. | TODO | BL-010 |
| `auth.signup.title` | SC-218 | Create-account header | Create your account | Crie sua conta | TODO | |
| `auth.signup.field.name` | SC-218 | Name label | Full name | Nome completo | TODO | |
| `auth.signup.field.email` | SC-218 | Email label | Email | E-mail | TODO | |
| `auth.signup.field.password` | SC-218 | Password label | Password | Senha | TODO | |
| `auth.signup.field.password_confirm` | SC-218 | Password confirm label | Confirm password | Confirmar senha | TODO | |
| `auth.signup.password_helper` | SC-218 | Password rule helper | Use at least 8 characters, including uppercase, number, and a symbol (e.g., ! @ #). | Use pelo menos 8 caracteres, com letra maiúscula, número e um símbolo (ex.: ! @ #). | TODO | |
| `auth.signup.validation.password_policy` | SC-218 | Password validation message | Password must include at least 8 characters, 1 uppercase letter, 1 number, and 1 symbol (e.g., ! @ #). | A senha deve ter pelo menos 8 caracteres, 1 letra maiúscula, 1 número e 1 símbolo (ex.: ! @ #). | TODO | |
| `auth.signup.validation.no_emoji` | SC-218 | Password validation message | Password cannot contain emoji. | A senha não pode conter emoji. | TODO | |
| `auth.signup.validation.password_mismatch` | SC-218 | Password mismatch message | Password confirmation does not match. | A confirmação de senha não confere. | TODO | |
| `auth.signup.validation.email_exists` | SC-218 | Duplicate email message | This email is already in use. Sign in to continue. | Este e-mail já está em uso. Faça login para continuar. | TODO | |
| `auth.password.toggle_show` | SC-217/SC-218 | Password visibility toggle | Show password | Mostrar senha | TODO | Accessibility and clarity |
| `auth.password.toggle_hide` | SC-217/SC-218 | Password visibility toggle | Hide password | Ocultar senha | TODO | Accessibility and clarity |
| `student.home.no_pro.title` | SC-203 | Empty-state card title | No professional connected yet | Nenhum profissional conectado ainda | TODO | |
| `student.home.no_pro.body` | SC-203 | Empty-state card helper | You can still start tracking today on your own. | Você ainda pode começar a acompanhar hoje por conta própria. | TODO | Non-blocking tone |
| `student.home.cta_start_nutrition` | SC-203 | Empty-state CTA | Start my nutrition plan | Começar meu plano de nutrição | TODO | |
| `student.home.cta_start_training` | SC-203 | Empty-state CTA | Start my training plan | Começar meu plano de treino | TODO | |
| `student.home.cta_manage_professionals` | SC-203 | Action CTA | Manage professionals | Gerenciar profissionais | TODO | |
| `student.home.offline.stale_badge` | SC-203 | Offline stale indicator | Data may be outdated | Os dados podem estar desatualizados | TODO | Show when cache is stale |
| `student.home.offline.last_sync` | SC-203 | Offline stale metadata | Last updated: {datetime} | Última atualização: {datetime} | TODO | Timestamp format localized |
| `student.home.offline.banner_read_only` | SC-203 | Offline persistent banner | You're offline. You can view cached data, but updates are locked until connection returns. | Você está offline. Você pode ver dados em cache, mas as atualizações ficam bloqueadas até a conexão voltar. | TODO | BL-008 |
| `student.home.offline.write_lock` | SC-203 | Offline blocked-write helper | Connect to the internet to save changes. | Conecte-se à internet para salvar alterações. | TODO | BL-008 |
| `relationship.title` | SC-211 | Screen title | Connect with professionals | Conectar com profissionais | TODO | Plain-language screen title |
| `relationship.intro` | SC-211 | Intro copy | Have a professional? Enter their invite code. | Tem um profissional? Insira o código de convite. | TODO | |
| `relationship.helper_self_guided` | SC-211 | Optionality helper | Don't have one yet? You can keep using the app on your own. | Ainda não tem? Você pode continuar usando o app por conta própria. | TODO | Critical clarity copy |
| `relationship.input.invite_code` | SC-211 | Input placeholder | Enter invite code | Inserir código de convite | TODO | |
| `relationship.cta_scan_qr` | SC-211 | QR scan action | Scan QR code | Escanear QR code | TODO | BL-002 |
| `relationship.cta_submit_code` | SC-211 | Submit CTA | Connect | Conectar | TODO | |
| `relationship.error.invalid_code` | SC-211 | Invite error message | This invite code is invalid. Ask your professional for a new code. | Este código de convite é inválido. Peça um novo código ao profissional. | TODO | BL-010 |
| `relationship.error.pending_cap` | SC-211 | Invite error message | This professional has too many pending requests right now. Try again later. | Este profissional está com muitas solicitações pendentes agora. Tente novamente mais tarde. | TODO | BL-010 |
| `relationship.pending.helper` | SC-211 | Pending assignment state | Waiting for professional confirmation to activate this connection. | Aguardando confirmação do profissional para ativar esta conexão. | TODO | |
| `relationship.pending.canceled_code_rotated` | SC-211 | Pending request canceled state | This request was canceled because the professional regenerated their invite code. Ask for the new code to reconnect. | Esta solicitação foi cancelada porque o profissional regenerou o código de convite. Peça o novo código para se conectar novamente. | TODO | |
| `pro.pending.search.placeholder` | SC-205 | Pending queue search | Search pending requests | Buscar solicitações pendentes | TODO | BL-004 |
| `pro.pending.filter.label` | SC-205 | Pending queue filter | Filter requests | Filtrar solicitações | TODO | BL-004 |
| `pro.pending.bulk_deny.cta` | SC-205 | Bulk deny action | Deny selected | Negar selecionadas | TODO | BL-004 |
| `pro.pending.bulk_deny.confirm_title` | SC-205 | Bulk deny confirmation | Deny selected requests? | Negar solicitações selecionadas? | TODO | BL-004 |
| `pro.pending.bulk_deny.confirm_body` | SC-205 | Bulk deny confirmation helper | Selected students can request again later with your invite code. | Alunos selecionados podem solicitar novamente depois com seu código de convite. | TODO | BL-004 |
| `pro.pending.bulk_deny.success` | SC-205 | Bulk deny success feedback | Requests denied successfully. | Solicitações negadas com sucesso. | TODO | BL-004 |
| `relationship.empty.cta_continue_self` | SC-211 | Empty-state CTA | Continue self-guided | Continuar por conta própria | TODO | |
| `relationship.unbind.cta` | SC-211 | Unbind action | End connection | Encerrar conexão | TODO | |
| `relationship.unbind.confirm_title` | SC-211 | Unbind confirmation modal | End this professional connection? | Encerrar esta conexão profissional? | TODO | |
| `relationship.unbind.confirm_body` | SC-211 | Unbind confirmation modal | You can reconnect later with an invite code. Your history will be kept. | Você pode se reconectar depois com um código de convite. Seu histórico será mantido. | TODO | Reflects retention policy |
| `relationship.unbind.confirm_yes` | SC-211 | Confirmation CTA | End connection | Encerrar conexão | TODO | |
| `relationship.unbind.confirm_no` | SC-211 | Cancel CTA | Keep connection | Manter conexão | TODO | |
| `relationship.credential.registry_id` | SC-211 | Credential field label | Registry ID | Registro profissional | TODO | Visible only for assigned professional |
| `relationship.credential.authority` | SC-211 | Credential field label | Authority | Órgão | TODO | Visible only for assigned professional |
| `relationship.credential.country` | SC-211 | Credential field label | Country | País | TODO | Visible only for assigned professional |
| `student.nutrition.empty.title` | SC-209 | Tracking empty state | No meals logged yet | Nenhuma refeição registrada ainda | TODO | |
| `student.nutrition.empty.helper` | SC-209 | Tracking empty helper | No nutritionist connected? You can still build and track your own plan today. | Sem nutricionista conectado? Você ainda pode criar e acompanhar seu próprio plano hoje. | TODO | Must preserve optionality |
| `student.nutrition.empty.cta` | SC-209 | Tracking empty CTA | Start my nutrition plan | Começar meu plano de nutrição | TODO | |
| `student.hydration.card_title` | SC-203/SC-209 | Hydration summary title | Water intake | Consumo de água | TODO | BL-104 |
| `student.hydration.progress` | SC-203/SC-209 | Hydration progress helper | {consumed} / {goal} ml | {consumido} / {meta} ml | TODO | BL-104 |
| `student.hydration.cta_log` | SC-209 | Hydration primary action | Log water | Registrar água | TODO | BL-104 |
| `student.hydration.cta_set_goal` | SC-209 | Hydration goal action | Set water goal | Definir meta de água | TODO | BL-104 |
| `student.hydration.goal_owner_student` | SC-209 | Goal ownership helper | Using your personal water goal | Usando sua meta pessoal de água | TODO | BL-104 |
| `student.hydration.goal_owner_nutritionist` | SC-209 | Goal ownership helper | Daily water goal defined by your nutritionist | Meta diária de água definida pelo seu nutricionista | TODO | BL-104 |
| `student.hydration.streak` | SC-203/SC-209 | Streak helper | Current streak: {days} days | Sequência atual: {days} dias | TODO | BL-104 |
| `student.plan_change.cta` | SC-209/SC-210 | Assigned-plan action | Request plan change | Solicitar alteração no plano | TODO | BL-005 |
| `student.plan_change.sheet.title` | SC-209/SC-210 | Change-request sheet title | What would you like to change? | O que você gostaria de mudar? | TODO | BL-005 |
| `student.plan_change.field.reason` | SC-209/SC-210 | Change-request input label | Explain your request | Explique sua solicitação | TODO | BL-005 |
| `student.plan_change.cta_submit` | SC-209/SC-210 | Submit change request CTA | Send request | Enviar solicitação | TODO | BL-005 |
| `student.plan_change.success` | SC-209/SC-210 | Change-request success feedback | Request sent to your professional. | Solicitação enviada ao seu profissional. | TODO | BL-005 |
| `pro.plan_change.inbox.title` | SC-206 | Professional change-request section | Plan change requests | Solicitações de alteração de plano | TODO | BL-005 |
| `pro.template_library.title` | SC-207/SC-208 | Starter template section title | Start from a template | Começar por um modelo | TODO | BL-006 |
| `pro.template_library.badge_starter` | SC-207/SC-208 | Starter template badge | Starter | Inicial | TODO | BL-006 |
| `pro.template_library.cta_use` | SC-207/SC-208 | Starter template CTA | Use template | Usar modelo | TODO | BL-006 |
| `pro.template.clone_notice` | SC-207/SC-208 | Template helper text | We create an editable copy. The original template does not change. | Criamos uma cópia editável. O modelo original não é alterado. | TODO | BL-006 |
| `pro.predefined_plan.field_name` | SC-207/SC-208 | Predefined plan name label | Predefined plan name | Nome do plano predefinido | TODO | BL-106 |
| `pro.predefined_plan.cta_create` | SC-207/SC-208 | Create predefined plan CTA | Save predefined plan | Salvar plano predefinido | TODO | BL-106 |
| `pro.predefined_plan.bulk_assign.cta` | SC-205/SC-207/SC-208 | Bulk assign entry CTA | Bulk assign plan | Atribuir plano em massa | TODO | BL-106 |
| `pro.predefined_plan.bulk_assign.title` | SC-205/SC-207/SC-208 | Bulk assign modal title | Assign this plan to multiple students | Atribuir este plano para vários alunos | TODO | BL-106 |
| `pro.predefined_plan.bulk_assign.select_students` | SC-205 | Bulk assign helper | Select students to receive this plan | Selecione os alunos que vão receber este plano | TODO | BL-106 |
| `pro.predefined_plan.bulk_assign.fine_tune_title` | SC-207/SC-208 | Fine-tune step title | Fine-tune each student plan | Ajustar o plano de cada aluno | TODO | BL-106 |
| `pro.predefined_plan.bulk_assign.cta_finalize` | SC-207/SC-208 | Final bulk assign CTA | Confirm assignments | Confirmar atribuições | TODO | BL-106 |
| `pro.predefined_plan.copy_independent_note` | SC-207/SC-208 | Copy isolation helper | Each student gets an independent copy. Future library edits won't change assigned plans. | Cada aluno recebe uma cópia independente. Alterações futuras na biblioteca não mudam planos já atribuídos. | TODO | BL-106 |
| `pro.student.water_goal.section_title` | SC-206 | Professional water goal section title | Student water goal | Meta de água do aluno | TODO | BL-104 |
| `pro.student.water_goal.field_daily_ml` | SC-206 | Professional water goal input label | Daily water goal (ml) | Meta diária de água (ml) | TODO | BL-104 |
| `pro.student.water_goal.cta_save` | SC-206 | Professional water goal save CTA | Save water goal | Salvar meta de água | TODO | BL-104 |
| `custom_meal.builder.title` | SC-214 | Builder screen title | Create custom meal | Criar refeição personalizada | TODO | |
| `custom_meal.builder.helper` | SC-214 | Builder helper text | Add total meal weight and nutrients. We use this to calculate any portion you log. | Adicione o peso total da refeição e os nutrientes. Usamos isso para calcular qualquer porção que você registrar. | TODO | |
| `custom_meal.field.name` | SC-214 | Field label | Meal name | Nome da refeição | TODO | |
| `custom_meal.field.total_grams` | SC-214 | Field label | Total meal weight (g) | Peso total da refeição (g) | TODO | |
| `custom_meal.field.calories` | SC-214 | Field label | Total calories | Calorias totais | TODO | |
| `custom_meal.field.carbs` | SC-214 | Field label | Carbs (g) | Carboidratos (g) | TODO | |
| `custom_meal.field.proteins` | SC-214 | Field label | Proteins (g) | Proteínas (g) | TODO | |
| `custom_meal.field.fats` | SC-214 | Field label | Fats (g) | Gorduras (g) | TODO | |
| `custom_meal.field.cost_optional` | SC-214 | Field label | Ingredient cost (optional) | Custo dos ingredientes (opcional) | TODO | |
| `custom_meal.field.image_optional` | SC-214 | Field label | Recipe image (optional) | Imagem da receita (opcional) | TODO | BL-007 |
| `custom_meal.image.upload_progress` | SC-214 | Upload progress helper | Uploading image... {progress}% | Enviando imagem... {progress}% | TODO | BL-007 |
| `custom_meal.image.upload_failed` | SC-214 | Upload failure helper | We couldn't upload the image. Check your connection and try again. | Não foi possível enviar a imagem. Verifique sua conexão e tente novamente. | TODO | BL-007 |
| `custom_meal.image.retry` | SC-214 | Upload retry CTA | Retry upload | Tentar envio novamente | TODO | BL-007 |
| `custom_meal.builder.cta_save` | SC-214 | Save action | Save meal | Salvar refeição | TODO | |
| `custom_meal.builder.validation.grams_positive` | SC-214 | Validation message | Total grams must be greater than zero. | O total em gramas deve ser maior que zero. | TODO | |
| `custom_meal.library.empty.title` | SC-215 | Empty-state title | No custom meals yet | Ainda não há refeições personalizadas | TODO | |
| `custom_meal.library.empty.helper` | SC-215 | Empty-state helper | Create your first custom meal to log portions in seconds. | Crie sua primeira refeição personalizada para registrar porções em segundos. | TODO | |
| `custom_meal.library.cta_create` | SC-215 | Empty-state CTA | Create custom meal | Criar refeição personalizada | TODO | |
| `custom_meal.quicklog.helper` | SC-215 | Portion log helper | Enter grams consumed. We calculate calories and macros automatically. | Insira os gramas consumidos. Calculamos calorias e macronutrientes automaticamente. | TODO | |
| `custom_meal.quicklog.field.grams` | SC-215 | Field label | Grams consumed | Gramas consumidos | TODO | |
| `custom_meal.quicklog.preview_title` | SC-215 | Calculation preview | Estimated nutrients for this portion | Nutrientes estimados para esta porção | TODO | |
| `custom_meal.quicklog.cta_log` | SC-215 | Log action | Log meal | Registrar refeição | TODO | |
| `custom_meal.share.cta` | SC-214/SC-215 | Share action | Share recipe | Compartilhar receita | TODO | |
| `custom_meal.share.link_copied` | SC-214/SC-215 | Share success feedback | Recipe link copied | Link da receita copiado | TODO | |
| `shared_recipe.confirm.title` | SC-216 | Confirmation header | Save shared recipe | Salvar receita compartilhada | TODO | |
| `shared_recipe.confirm.helper` | SC-216 | Confirmation helper | Save this recipe to your account to use it in your daily tracking. | Salve esta receita na sua conta para usá-la no seu acompanhamento diário. | TODO | |
| `shared_recipe.confirm.ownership_note` | SC-216 | Ownership disclosure | After saving, this copy is yours even if the original creator deletes theirs. | Depois de salvar, esta cópia é sua mesmo que o criador original exclua a dele. | TODO | |
| `shared_recipe.confirm.cta_save` | SC-216 | Primary action | Save to my account | Salvar na minha conta | TODO | |
| `shared_recipe.confirm.cta_cancel` | SC-216 | Secondary action | Not now | Agora não | TODO | |
| `shared_recipe.error.invalid_link` | SC-216 | Invalid token state | This shared recipe link is invalid. | Este link de receita compartilhada é inválido. | TODO | |
| `shared_recipe.success.saved` | SC-216 | Save success feedback | Recipe saved to your account | Receita salva na sua conta | TODO | |
| `shared_recipe.auth.required` | SC-216 | Login-required helper | Sign in to save this recipe. We'll bring you back here right after login. | Entre para salvar esta receita. Vamos trazer você de volta para cá logo após o login. | TODO | |
| `shared_recipe.info.already_saved` | SC-216 | Idempotent import helper | You already saved this recipe in your account. | Você já salvou esta receita na sua conta. | TODO | |
| `student.training.empty.title` | SC-210 | Tracking empty state | No workout scheduled yet | Nenhum treino agendado ainda | TODO | |
| `student.training.empty.helper` | SC-210 | Tracking empty helper | No coach connected? You can still create your own training plan now. | Sem treinador conectado? Você ainda pode criar seu próprio plano de treino agora. | TODO | Must preserve optionality |
| `student.training.empty.cta` | SC-210 | Tracking empty CTA | Start my training plan | Começar meu plano de treino | TODO | |
| `pro.subscription.limit_title` | SC-212 | Cap gate title | Unlock more than 10 active students | Desbloqueie mais de 10 alunos ativos | TODO | Professional-only monetization |
| `pro.subscription.limit_body` | SC-212 | Cap gate helper | Upgrade your professional plan to manage more than 10 active students. | Faça upgrade do seu plano profissional para gerenciar mais de 10 alunos ativos. | TODO | |
| `pro.subscription.cta_subscribe` | SC-212 | Purchase CTA | Upgrade now | Fazer upgrade agora | TODO | |
| `pro.subscription.cta_restore` | SC-212 | Restore CTA | Restore purchase | Restaurar compra | TODO | |
| `pro.subscription.status_active` | SC-212 | Entitlement badge | Subscription active | Assinatura ativa | TODO | |
| `pro.subscription.pre_lapse.title` | SC-212 | Pre-lapse warning title | Your subscription is close to expiring | Sua assinatura está perto de expirar | TODO | BL-009 |
| `pro.subscription.pre_lapse.body` | SC-212 | Pre-lapse warning helper | Renew now to avoid student management locks. | Renove agora para evitar bloqueios no gerenciamento de alunos. | TODO | BL-009 |
| `pro.subscription.pre_lapse.cta_renew` | SC-212 | Pre-lapse warning CTA | Renew subscription | Renovar assinatura | TODO | BL-009 |
| `pro.specialty.remove_blocked.title` | SC-202 | Specialty blocked-state title | You can't remove this specialty yet | Você ainda não pode remover esta especialidade | TODO | BL-011 |
| `pro.specialty.remove_blocked.body` | SC-202 | Specialty blocked-state helper | Resolve active or pending student links for this specialty first. | Resolva primeiro os vínculos de alunos ativos ou pendentes desta especialidade. | TODO | BL-011 |
| `pro.specialty.remove_blocked.cta_view_active` | SC-202 | Blocked-state CTA | View active students | Ver alunos ativos | TODO | BL-011 |
| `pro.specialty.remove_blocked.cta_manage_pending` | SC-202 | Blocked-state CTA | Manage pending requests | Gerenciar solicitações pendentes | TODO | BL-011 |
| `settings.account.title` | SC-213 | Settings header | Account and privacy | Conta e privacidade | TODO | |
| `settings.account.cta_privacy_policy` | SC-213 | Legal link CTA | View privacy policy | Ver política de privacidade | TODO | |
| `settings.account.cta_delete_account` | SC-213 | Deletion CTA | Delete account | Excluir conta | TODO | Store compliance critical |
| `settings.account.delete.confirm_title` | SC-213 | Deletion confirmation | Delete your account? | Excluir sua conta? | TODO | |
| `settings.account.delete.confirm_body` | SC-213 | Deletion warning | This starts your account deletion request. Some data may be retained when legally required. | Isso inicia sua solicitação de exclusão de conta. Alguns dados podem ser retidos quando exigidos por lei. | TODO | Compliance-sensitive text |
| `settings.account.delete.confirm_yes` | SC-213 | Confirm deletion CTA | Request deletion | Solicitar exclusão | TODO | |
| `settings.account.delete.confirm_no` | SC-213 | Cancel CTA | Cancel | Cancelar | TODO | |
| `common.error.retry` | Common | Generic error action | Try again | Tentar novamente | TODO | Shared utility string |
| `common.loading.default` | Common | Generic loading text | Loading... | Carregando... | TODO | Shared utility string |
| `common.empty.no_data` | Common | Generic empty text | Nothing here yet. | Ainda não há nada aqui. | TODO | Use only when screen-specific copy is unavailable |

## Notes
- Replace `TODO` translations after localization review.
- Keep this file aligned with screen specs and implementation keys.

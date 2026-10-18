package <base>;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import com.tngtech.archunit.library.GeneralCodingRules;

/**
 * cuadrilla java-spring dependency rules. Mandatory: runs in {@code ./mvnw -B verify}.
 * Replace {@code <base>} with the root package from the project profile. Rules may be added,
 * never removed or relaxed to make a change pass. Annotation types are referenced by name so
 * the test compiles whether or not optional libraries (JPA) are on the classpath.
 */
@AnalyzeClasses(packages = "<base>", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    private static final String API = "<base>.api..";
    private static final String API_SECURITY = "<base>.api.security..";
    private static final String APPLICATION = "<base>.application..";
    private static final String DOMAIN = "<base>.domain..";
    private static final String INFRASTRUCTURE = "<base>.infrastructure..";

    private static final String TRANSACTIONAL = "org.springframework.transaction.annotation.Transactional";
    private static final String JAKARTA_TRANSACTIONAL = "jakarta.transaction.Transactional";
    private static final String REQUEST_MAPPING = "org.springframework.web.bind.annotation.RequestMapping";
    private static final String REST_CONTROLLER = "org.springframework.web.bind.annotation.RestController";
    private static final String CONTROLLER = "org.springframework.stereotype.Controller";
    private static final String CONTROLLER_ADVICE = "org.springframework.web.bind.annotation.ControllerAdvice";
    private static final String REST_CONTROLLER_ADVICE = "org.springframework.web.bind.annotation.RestControllerAdvice";
    private static final String PRE_AUTHORIZE = "org.springframework.security.access.prepost.PreAuthorize";
    private static final String PUBLIC_ENDPOINT = "<base>.api.security.PublicEndpoint";
    private static final String ENTITY = "jakarta.persistence.Entity";
    private static final String SECURITY_CONTEXT_HOLDER =
            "org.springframework.security.core.context.SecurityContextHolder";

    // api -> application -> domain <- infrastructure ; api -> domain
    @ArchTest
    static final ArchRule layers = layeredArchitecture()
            .consideringOnlyDependenciesInLayers()
            .withOptionalLayers(true)
            .layer("Api").definedBy(API)
            .layer("Application").definedBy(APPLICATION)
            .layer("Domain").definedBy(DOMAIN)
            .layer("Infrastructure").definedBy(INFRASTRUCTURE)
            .whereLayer("Api").mayNotBeAccessedByAnyLayer()
            .whereLayer("Application").mayOnlyBeAccessedByLayers("Api")
            .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer()
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Api", "Application", "Infrastructure");

    @ArchTest
    static final ArchRule domain_is_framework_free = noClasses()
            .that().resideInAPackage(DOMAIN)
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework.web..",
                    "org.springframework.jdbc..",
                    "org.springframework.security..",
                    "org.springframework.stereotype..",
                    "org.springframework.context..",
                    "org.springframework.beans..",
                    "org.springframework.transaction..",
                    "org.springframework.data..",
                    "jakarta.servlet..",
                    "jakarta.persistence..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule application_has_no_web_sql_or_security = noClasses()
            .that().resideInAPackage(APPLICATION)
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework.web..",
                    "org.springframework.jdbc..",
                    "org.springframework.security..",
                    "org.springframework.data..",
                    "jakarta.servlet..",
                    "jakarta.persistence..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule controllers_live_in_api = classes()
            .that().areAnnotatedWith(REST_CONTROLLER)
            .or().areAnnotatedWith(CONTROLLER)
            .or().areAnnotatedWith(REST_CONTROLLER_ADVICE)
            .or().areAnnotatedWith(CONTROLLER_ADVICE)
            .should().resideInAPackage(API)
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule transactional_classes_only_in_application = classes()
            .that().areAnnotatedWith(TRANSACTIONAL)
            .or().areAnnotatedWith(JAKARTA_TRANSACTIONAL)
            .should().resideInAPackage(APPLICATION)
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule transactional_methods_only_in_application = methods()
            .that().areAnnotatedWith(TRANSACTIONAL)
            .or().areAnnotatedWith(JAKARTA_TRANSACTIONAL)
            .should().beDeclaredInClassesThat().resideInAPackage(APPLICATION)
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule security_context_only_in_api_security = noClasses()
            .that().resideOutsideOfPackage(API_SECURITY)
            .should().dependOnClassesThat().haveFullyQualifiedName(SECURITY_CONTEXT_HOLDER)
            .because("services read the user through the CurrentUser port")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule entities_stay_in_infrastructure = noClasses()
            .that().resideOutsideOfPackage(INFRASTRUCTURE)
            .should().dependOnClassesThat().areAnnotatedWith(ENTITY)
            .because("JPA entities never leave infrastructure (only relevant if the profile allows JPA)")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule endpoints_declare_authorization = methods()
            .that().areMetaAnnotatedWith(REQUEST_MAPPING)
            .and().areDeclaredInClassesThat().resideInAPackage(API)
            .should(declareAuthorization())
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule no_field_injection = GeneralCodingRules.NO_CLASSES_SHOULD_USE_FIELD_INJECTION;

    @ArchTest
    static final ArchRule no_java_util_logging = GeneralCodingRules.NO_CLASSES_SHOULD_USE_JAVA_UTIL_LOGGING;

    private static ArchCondition<JavaMethod> declareAuthorization() {
        return new ArchCondition<>("be annotated with @PreAuthorize (method or class) or @PublicEndpoint") {
            @Override
            public void check(JavaMethod method, ConditionEvents events) {
                boolean authorized = method.isAnnotatedWith(PRE_AUTHORIZE)
                        || method.getOwner().isAnnotatedWith(PRE_AUTHORIZE)
                        || method.isAnnotatedWith(PUBLIC_ENDPOINT);
                if (!authorized) {
                    events.add(SimpleConditionEvent.violated(
                            method, method.getFullName() + " has neither @PreAuthorize nor @PublicEndpoint"));
                }
            }
        };
    }
}

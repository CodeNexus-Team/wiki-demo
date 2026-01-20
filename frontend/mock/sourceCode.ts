
export const MOCK_REPO_FILES: Record<string, string> = {
  "cloudmart-order/src/main/java/com/cloudmart/order/controller/OrderController.java": `package com.cloudmart.order.controller;

import com.cloudmart.order.dto.OrderRequest;
import com.cloudmart.order.dto.OrderResponse;
import com.cloudmart.order.service.OrderService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import jakarta.validation.Valid;
import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api/v1/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    /**
     * Create a new order from the shopping cart items.
     * @param request Order creation request containing items and user ID
     * @return The created order details including order ID and total amount
     */
    @PostMapping
    public ResponseEntity<OrderResponse> createOrder(@RequestBody @Valid OrderRequest request) {
        log.info("Received order request for user: {}", request.getUserId());
        
        // Basic validation
        if (request.getItems() == null || request.getItems().isEmpty()) {
            log.warn("Order creation failed: Empty items list for user {}", request.getUserId());
            throw new IllegalArgumentException("Order items cannot be empty");
        }
        
        try {
            OrderResponse response = orderService.createOrder(request);
            log.info("Order created successfully: {}", response.getOrderId());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Failed to create order", e);
            throw e;
        }
    }

    /**
     * Retrieve order details by ID.
     * @param id Order ID
     * @return Order details
     */
    @GetMapping("/{id}")
    public ResponseEntity<OrderResponse> getOrder(@PathVariable Long id) {
        log.debug("Fetching order details for id: {}", id);
        return ResponseEntity.ok(orderService.getOrderById(id));
    }
    
    /**
     * Cancel an existing order.
     * @param id Order ID
     */
    @PostMapping("/{id}/cancel")
    public ResponseEntity<Void> cancelOrder(@PathVariable Long id) {
        log.info("Request to cancel order: {}", id);
        orderService.cancelOrder(id);
        return ResponseEntity.ok().build();
    }
    
    @GetMapping("/user/{userId}")
    public ResponseEntity<List<OrderResponse>> getOrdersByUser(@PathVariable Long userId) {
        return ResponseEntity.ok(orderService.getOrdersByUserId(userId));
    }
}`,

  "cloudmart-order/src/main/java/com/cloudmart/order/service/OrderService.java": `package com.cloudmart.order.service;

import com.cloudmart.order.repository.OrderRepository;
import com.cloudmart.order.client.InventoryClient;
import com.cloudmart.order.client.PaymentClient;
import com.cloudmart.order.domain.Order;
import com.cloudmart.order.domain.OrderStatus;
import com.cloudmart.order.dto.PaymentResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import lombok.extern.slf4j.Slf4j;
import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final InventoryClient inventoryClient;
    private final PaymentClient paymentClient;
    private final KafkaTemplate<String, OrderEvent> kafkaTemplate;

    public OrderService(OrderRepository orderRepository, 
                        InventoryClient inventoryClient, 
                        PaymentClient paymentClient,
                        KafkaTemplate<String, OrderEvent> kafkaTemplate) {
        this.orderRepository = orderRepository;
        this.inventoryClient = inventoryClient;
        this.paymentClient = paymentClient;
        this.kafkaTemplate = kafkaTemplate;
    }

    /**
     * Orchestrates the order creation process.
     * 1. Validate Stock
     * 2. Create Pending Order
     * 3. Lock Stock
     * 4. Process Payment
     * 5. Finalize Order
     */
    @Transactional
    @CircuitBreaker(name = "inventory", fallbackMethod = "inventoryFallback")
    public OrderResponse createOrder(OrderRequest request) {
        log.info("Starting order creation saga for user {}", request.getUserId());

        // 1. Check Inventory via Feign Client
        log.debug("Checking inventory availability");
        boolean available = inventoryClient.checkStock(request.getItems());
        if (!available) {
            log.warn("Inventory check failed for request {}", request);
            throw new RuntimeException("Insufficient stock for one or more items");
        }

        // 2. Create Order Entity (PENDING state)
        Order order = new Order(request.getUserId(), request.getItems());
        order.setStatus(OrderStatus.PENDING);
        order.setCreatedAt(LocalDateTime.now());
        order.setTotalAmount(calculateTotal(request.getItems()));
        orderRepository.save(order);
        log.debug("Order {} saved with PENDING status", order.getId());

        // 3. Lock Inventory (Distributed Lock/Reserve)
        try {
            inventoryClient.lockStock(request.getItems());
        } catch (Exception e) {
            log.error("Failed to lock stock", e);
            order.setStatus(OrderStatus.FAILED);
            orderRepository.save(order);
            throw new RuntimeException("Failed to lock inventory");
        }

        // 4. Process Payment
        PaymentResult payment = paymentClient.process(order.getId(), order.getTotalAmount());
        
        if (payment.isSuccess()) {
            order.setStatus(OrderStatus.PAID);
            order.setPaidAt(LocalDateTime.now());
            log.info("Payment successful for order {}", order.getId());
            
            // Emit OrderPaidEvent to Kafka for asynchronous processing (e.g. shipping, notifications)
            kafkaTemplate.send("order-events", new OrderEvent(order.getId(), "ORDER_PAID"));
        } else {
            log.warn("Payment failed for order {}", order.getId());
            order.setStatus(OrderStatus.CANCELLED);
            
            // Compensating transaction: Release the locked stock
            inventoryClient.releaseStock(request.getItems()); 
            throw new RuntimeException("Payment processing failed");
        }

        return mapToResponse(orderRepository.save(order));
    }
    
    // Fallback method for CircuitBreaker
    public OrderResponse inventoryFallback(OrderRequest request, Throwable t) {
        log.error("Inventory service is unavailable: {}", t.getMessage());
        throw new RuntimeException("Inventory service is currently unavailable, please try again later.");
    }

    public OrderResponse getOrderById(Long id) {
        return orderRepository.findById(id)
                .map(this::mapToResponse)
                .orElseThrow(() -> new RuntimeException("Order not found: " + id));
    }
    
    @Transactional
    public void cancelOrder(Long id) {
        Order order = orderRepository.findById(id).orElseThrow();
        
        if (order.getStatus() == OrderStatus.SHIPPED || order.getStatus() == OrderStatus.DELIVERED) {
            throw new IllegalStateException("Cannot cancel an order that has already been shipped or delivered");
        }
        
        OrderStatus oldStatus = order.getStatus();
        order.setStatus(OrderStatus.CANCELLED);
        
        // Release stock if necessary
        if (oldStatus == OrderStatus.PAID || oldStatus == OrderStatus.PENDING) {
            inventoryClient.releaseStock(order.getItems());
        }
        
        orderRepository.save(order);
        log.info("Order {} cancelled successfully", id);
    }
    
    private Double calculateTotal(List<OrderItem> items) {
        // Mock calculation
        return items.stream().mapToDouble(i -> i.getPrice() * i.getQuantity()).sum();
    }
    
    private OrderResponse mapToResponse(Order order) {
        return new OrderResponse(order);
    }
    
    public List<OrderResponse> getOrdersByUserId(Long userId) {
        return orderRepository.findByUserId(userId)
                .stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }
}`,

"cloudmart-inventory/src/main/java/com/cloudmart/inventory/service/InventoryService.java": `package com.cloudmart.inventory.service;

import org.springframework.stereotype.Service;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import java.util.List;
import java.util.Collections;

@Service
public class InventoryService {
    
    private final RedisTemplate<String, Integer> redisTemplate;
    private final InventoryRepository inventoryRepository;
    
    public InventoryService(RedisTemplate<String, Integer> redisTemplate, InventoryRepository inventoryRepository) {
        this.redisTemplate = redisTemplate;
        this.inventoryRepository = inventoryRepository;
    }

    /**
     * Check if stock is sufficient for a list of items.
     * Uses Redis cache for low latency.
     */
    public boolean checkStock(List<OrderItem> items) {
        for (OrderItem item : items) {
            Integer currentStock = redisTemplate.opsForValue().get("stock:" + item.getProductId());
            
            // Cache miss fallback to DB
            if (currentStock == null) {
                currentStock = inventoryRepository.getStock(item.getProductId());
                redisTemplate.opsForValue().set("stock:" + item.getProductId(), currentStock);
            }
            
            if (currentStock < item.getQuantity()) {
                return false;
            }
        }
        return true;
    }

    /**
     * Atomically lock stock using Redis Lua scripts.
     * Ensures no over-selling in high concurrency.
     */
    public void lockStock(List<OrderItem> items) {
        // Lua script: Check if value >= required, then decrement. Return 1 (success) or 0 (fail).
        String script = "if tonumber(redis.call('get', KEYS[1])) >= tonumber(ARGV[1]) then " +
                        "   redis.call('decrby', KEYS[1], ARGV[1]); " +
                        "   return 1; " +
                        "else " +
                        "   return 0; " +
                        "end";
                        
        for (OrderItem item : items) {
            // Execute atomic decrement
            Boolean result = redisTemplate.execute(
                new DefaultRedisScript<>(script, Boolean.class), 
                Collections.singletonList("stock:" + item.getProductId()), 
                String.valueOf(item.getQuantity())
            );
            
            if (Boolean.FALSE.equals(result)) {
                throw new RuntimeException("Stock changed during lock phase for product " + item.getProductId());
            }
        }
        
        // Async: Sync to DB eventually
    }
    
    /**
     * Release stock (e.g. on order cancellation).
     */
    public void releaseStock(List<OrderItem> items) {
        for (OrderItem item : items) {
            redisTemplate.opsForValue().increment("stock:" + item.getProductId(), item.getQuantity());
        }
    }
    
    public void addStock(Long productId, Integer quantity) {
        inventoryRepository.addStock(productId, quantity);
        redisTemplate.delete("stock:" + productId); // Invalidate cache
    }
}`,

"cloudmart-user/src/main/java/com/cloudmart/user/service/UserService.java": `package com.cloudmart.user.service;

import com.cloudmart.user.domain.User;
import com.cloudmart.user.repository.UserRepository;
import com.cloudmart.user.dto.UserProfile;
import com.cloudmart.user.dto.AddressDTO;
import com.cloudmart.user.exception.UserNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.cache.annotation.Cacheable;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class UserService {
    
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Cacheable(value = "users", key = "#userId")
    public UserProfile getUserProfile(Long userId) {
        log.debug("Fetching user profile for id: {}", userId);
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found with id: " + userId));
            
        return new UserProfile(
            user.getId(),
            user.getUsername(), 
            user.getEmail(), 
            user.getPhoneNumber(),
            user.getAddresses()
        );
    }
    
    public User registerUser(UserRegistrationRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new IllegalArgumentException("Email already in use");
        }
        
        User user = new User();
        user.setEmail(request.getEmail());
        user.setUsername(request.getUsername());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRoles(Set.of("ROLE_USER"));
        user.setActive(true);
        
        return userRepository.save(user);
    }
    
    public void updateUserAddress(Long userId, AddressDTO address) {
        User user = userRepository.findById(userId).orElseThrow();
        user.getAddresses().add(mapToAddress(address));
        userRepository.save(user);
        // Evict cache if necessary
    }
}`,

"cloudmart-gateway/src/main/resources/application.yml": `server:
  port: 8080

spring:
  application:
    name: cloudmart-gateway
  cloud:
    gateway:
      discovery:
        locator:
          enabled: true
          lower-case-service-id: true
      routes:
        # Order Service Route
        - id: order-service
          uri: lb://cloudmart-order
          predicates:
            - Path=/api/v1/orders/**
          filters:
            - name: AuthenticationFilter
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20
            - name: CircuitBreaker
              args:
                name: orderCircuitBreaker
                fallbackUri: forward:/fallback/order
                
        # User Service Route
        - id: user-service
          uri: lb://cloudmart-user
          predicates:
            - Path=/api/v1/users/**
          filters:
            - name: AuthenticationFilter
            - name: Retry
              args:
                retries: 3
                statuses: BAD_GATEWAY, SERVICE_UNAVAILABLE
            
        # Product Service Route
        - id: product-service
          uri: lb://cloudmart-product
          predicates:
            - Path=/api/v1/products/**
            - Method=GET

management:
  endpoints:
    web:
      exposure:
        include: "*"

logging:
  level:
    org.springframework.cloud.gateway: INFO
    reactor.netty: INFO
`,

"cloudmart-payment/src/main/java/com/cloudmart/payment/service/PaymentService.java": `package com.cloudmart.payment.service;

import com.cloudmart.payment.dto.PaymentRequest;
import com.cloudmart.payment.dto.PaymentResult;
import com.cloudmart.payment.integration.StripeClient;
import com.cloudmart.payment.integration.PayPalClient;
import org.springframework.stereotype.Service;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class PaymentService {

    private final StripeClient stripeClient;
    private final PayPalClient payPalClient;

    public PaymentService(StripeClient stripeClient, PayPalClient payPalClient) {
        this.stripeClient = stripeClient;
        this.payPalClient = payPalClient;
    }

    public PaymentResult processPayment(PaymentRequest request) {
        log.info("Processing payment for order {} with amount {}", request.getOrderId(), request.getAmount());
        
        try {
            // Strategy pattern to select payment provider
            PaymentResult result;
            if ("PAYPAL".equalsIgnoreCase(request.getProvider())) {
                result = payPalClient.charge(request);
            } else {
                result = stripeClient.charge(request);
            }
            
            // Record transaction in database
            recordTransaction(request, result);
            
            return result;
        } catch (Exception e) {
            log.error("Payment processing failed", e);
            return PaymentResult.failed("Payment gateway error: " + e.getMessage());
        }
    }
    
    private void recordTransaction(PaymentRequest request, PaymentResult result) {
        // Save to transaction log table
    }
}
`,

"cloudmart-common/src/main/java/com/cloudmart/common/exception/GlobalExceptionHandler.java": `package com.cloudmart.common.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import java.time.LocalDateTime;

@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(ResourceNotFoundException ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.NOT_FOUND.value(),
            ex.getMessage(),
            LocalDateTime.now()
        );
        return new ResponseEntity<>(error, HttpStatus.NOT_FOUND);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleBadRequest(IllegalArgumentException ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.BAD_REQUEST.value(),
            ex.getMessage(),
            LocalDateTime.now()
        );
        return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGlobalError(Exception ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.INTERNAL_SERVER_ERROR.value(),
            "An unexpected error occurred",
            LocalDateTime.now()
        );
        return new ResponseEntity<>(error, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
`,

"cloudmart-product/src/main/java/com/cloudmart/product/controller/ProductController.java": `package com.cloudmart.product.controller;

import com.cloudmart.product.service.ProductService;
import com.cloudmart.product.dto.ProductDTO;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.*;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    @GetMapping
    public ResponseEntity<Page<ProductDTO>> searchProducts(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String category,
            Pageable pageable) {
        return ResponseEntity.ok(productService.search(query, category, pageable));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ProductDTO> getProduct(@PathVariable Long id) {
        return ResponseEntity.ok(productService.findById(id));
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ProductDTO> createProduct(@RequestBody ProductDTO product) {
        return ResponseEntity.ok(productService.create(product));
    }
}
`,

"cloudmart-cart/src/main/java/com/cloudmart/cart/service/CartService.java": `package com.cloudmart.cart.service;

import com.cloudmart.cart.model.Cart;
import com.cloudmart.cart.model.CartItem;
import com.cloudmart.cart.repository.CartRepository;
import org.springframework.stereotype.Service;
import java.util.Optional;

@Service
public class CartService {
    
    private final CartRepository cartRepository;
    private final ProductClient productClient;

    public CartService(CartRepository cartRepository, ProductClient productClient) {
        this.cartRepository = cartRepository;
        this.productClient = productClient;
    }

    public Cart getCart(Long userId) {
        return cartRepository.findByUserId(userId)
                .orElseGet(() -> createNewCart(userId));
    }

    public Cart addItem(Long userId, Long productId, int quantity) {
        Cart cart = getCart(userId);
        Optional<CartItem> existingItem = cart.getItems().stream()
                .filter(i -> i.getProductId().equals(productId))
                .findFirst();

        if (existingItem.isPresent()) {
            existingItem.get().setQuantity(existingItem.get().getQuantity() + quantity);
        } else {
            // Fetch product details
            ProductDTO product = productClient.getProduct(productId);
            CartItem newItem = new CartItem();
            newItem.setProductId(productId);
            newItem.setProductName(product.getName());
            newItem.setPrice(product.getPrice());
            newItem.setQuantity(quantity);
            cart.getItems().add(newItem);
        }
        
        return cartRepository.save(cart);
    }

    public void removeItem(Long userId, Long productId) {
        Cart cart = getCart(userId);
        cart.getItems().removeIf(i -> i.getProductId().equals(productId));
        cartRepository.save(cart);
    }
    
    public void clearCart(Long userId) {
        Cart cart = getCart(userId);
        cart.getItems().clear();
        cartRepository.save(cart);
    }

    private Cart createNewCart(Long userId) {
        Cart cart = new Cart();
        cart.setUserId(userId);
        return cartRepository.save(cart);
    }
}`,

"cloudmart-auth/src/main/java/com/cloudmart/auth/config/SecurityConfig.java": `package com.cloudmart.auth.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .authorizeHttpRequests()
            .requestMatchers("/auth/**").permitAll()
            .anyRequest().authenticated()
            .and()
            .sessionManagement().disable();
        return http.build();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}`,

"cloudmart-notification/src/main/java/com/cloudmart/notification/listener/OrderEventListener.java": `package com.cloudmart.notification.listener;

import com.cloudmart.common.event.OrderEvent;
import com.cloudmart.notification.service.EmailService;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
public class OrderEventListener {

    private final EmailService emailService;

    public OrderEventListener(EmailService emailService) {
        this.emailService = emailService;
    }

    @KafkaListener(topics = "order-events", groupId = "notification-group")
    public void handleOrderEvent(OrderEvent event) {
        log.info("Received order event: {}", event);
        
        if ("ORDER_PAID".equals(event.getType())) {
            emailService.sendOrderConfirmation(event.getOrderId());
        } else if ("ORDER_SHIPPED".equals(event.getType())) {
            emailService.sendShippingUpdate(event.getOrderId());
        }
    }
}`
};

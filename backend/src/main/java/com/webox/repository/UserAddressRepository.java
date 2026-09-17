package com.webox.repository;

import com.webox.domain.UserAddress;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAddressRepository extends JpaRepository<UserAddress, Long> {

    List<UserAddress> findByUserIdOrderByLastUsedAtDesc(Long userId, Limit limit);

    Optional<UserAddress> findByUserIdAndAddress(Long userId, String address);
}
